import type { Chunk, Coverage, DocumentRecord } from "./workspace";
import type { OfficePart } from "./office-archive";
import { readFileBytes } from "./file-read";

const MAX_TEXT = 500_000,
  MAX_SLIDES = 150;
const WORD_NS = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);
const DRAW_NS = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://purl.oclc.org/ooxml/drawingml/main",
]);
const MATH_NS = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/math",
  "http://purl.oclc.org/ooxml/officeDocument/math",
]);
function xmlDocument(xml: string): XMLDocument {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Office XML declarations are unsupported.");
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  if (parsed.getElementsByTagName("parsererror").length)
    throw new Error(
      "Office document XML is malformed. Re-save the file and retry.",
    );
  return parsed;
}
function visibleText(root: Node, word = false): string {
  const result: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const item = node as Element;
      return WORD_NS.has(item.namespaceURI ?? "") && item.localName === "del"
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (
    let node = walker.nextNode() as Element | null;
    node;
    node = walker.nextNode() as Element | null
  ) {
    const namespace = node.namespaceURI ?? "";
    if (!(
      DRAW_NS.has(namespace) ||
      (word && (WORD_NS.has(namespace) || MATH_NS.has(namespace)))
    ))
      continue;
    if (node.localName === "t") result.push(node.textContent ?? "");
    else if (["p", "tr", "br", "cr"].includes(node.localName))
      result.push("\n");
    else if (["tab", "tc"].includes(node.localName)) result.push("\t");
  }
  return result
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function relationships(
  parts: Map<string, string>,
  name: string,
): Map<string, { target: string; type: string }> {
  const xml = parts.get(name);
  const result = new Map<string, { target: string; type: string }>();
  if (!xml) return result;
  for (const item of Array.from(
    xmlDocument(xml).getElementsByTagNameNS("*", "Relationship"),
  )) {
    if (item.getAttribute("TargetMode")?.toLowerCase() === "external") continue;
    result.set(item.getAttribute("Id") ?? "", {
      target: item.getAttribute("Target") ?? "",
      type: item.getAttribute("Type") ?? "",
    });
  }
  return result;
}
function internalPath(base: string, target: string): string {
  if (/^[a-z]+:|[\\?#%]/i.test(target))
    throw new Error(
      "Unsupported Office relationship target; external content is never loaded.",
    );
  const path = target.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") {
      if (!path.length) throw new Error("Invalid Office relationship path.");
      path.pop();
    } else if (part && part !== ".") path.push(part);
  }
  return path.join("/");
}
function notesText(xml: string): string {
  const parsed = xmlDocument(xml);
  return Array.from(parsed.getElementsByTagNameNS("*", "sp"))
    .filter((shape) => {
      const placeholder = shape
        .getElementsByTagNameNS("*", "ph")[0]
        ?.getAttribute("type");
      return (
        !placeholder ||
        !["sldImg", "sldNum", "hdr", "ftr", "dt"].includes(placeholder)
      );
    })
    .map((shape) => visibleText(shape))
    .filter(Boolean)
    .join("\n");
}
type ExtractedOffice = Pick<
  DocumentRecord,
  "text" | "chunks" | "coverage" | "status" | "parserVersion"
>;
export function extractOfficeParts(
  input: OfficePart[],
  kind: "word" | "slides",
  progress: (message: string) => void,
): ExtractedOffice {
  const parts = new Map(input.map((p) => [p.name, p.xml]));
  let text = "",
    truncated = false,
    warnings = 0,
    nonempty = 0;
  const chunks: Chunk[] = [];
  const append = (label: string, value: string, slide?: number) => {
    if (!value.trim()) return;
    const prefix = `${text ? "\n\n" : ""}[${label}]\n`,
      start = text.length + (text ? 2 : 0);
    if (start >= MAX_TEXT) {
      truncated = true;
      return;
    }
    nonempty++;
    const next = text + prefix + value;
    text = next.slice(0, MAX_TEXT);
    truncated ||= next.length > MAX_TEXT;
    chunks.push({
      start,
      end: text.length,
      ...(slide === undefined ? {} : { slide }),
    });
  };
  let coverage: Coverage;
  if (kind === "word") {
    const main = parts.get("word/document.xml");
    if (!main)
      throw new Error(
        "Word document body is missing. Legacy .doc and renamed files are not supported.",
      );
    progress("Reading Word paragraphs and tables locally…");
    append("Document", visibleText(xmlDocument(main), true));
    for (const [name, xml] of [...parts]
      .filter(([name]) =>
        /^word\/(footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(name),
      )
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
      if (text.length >= MAX_TEXT) {
        truncated = true;
        break;
      }
      try {
        append(
          name.split("/").pop()!.replace(".xml", ""),
          visibleText(xmlDocument(xml), true),
        );
      } catch {
        warnings++;
      }
    }
    coverage = {
      truncated,
      note: `Word body paragraphs/tables and available headers, footers, footnotes and endnotes extracted as text. Page layout is not reconstructed. Images, embedded files, comments and field/formula results may be omitted; hidden text and drawing order may differ from the visual document.${warnings ? ` ${warnings} supplementary parts could not be read.` : ""}${truncated ? " Extraction capped at 500,000 characters." : ""}`,
    };
  } else {
    const presentation = parts.get("ppt/presentation.xml");
    if (!presentation)
      throw new Error(
        "PowerPoint presentation is missing. Legacy .ppt and renamed files are not supported.",
      );
    const ids = Array.from(
      xmlDocument(presentation).getElementsByTagNameNS("*", "sldId"),
    );
    if (!ids.length)
      throw new Error("PowerPoint has no slides in its presentation order.");
    const links = relationships(parts, "ppt/_rels/presentation.xml.rels");
    let slidesRead = 0,
      emptySlides = 0,
      notesRead = 0;
    for (const [index, id] of ids.slice(0, MAX_SLIDES).entries()) {
      if (text.length >= MAX_TEXT) {
        truncated = true;
        break;
      }
      progress(`Reading slide ${index + 1} of ${ids.length}…`);
      const relationshipId =
        Array.from(id.attributes).find((a) => a.localName === "id" && a.prefix)
          ?.value ?? "";
      const link = links.get(relationshipId);
      try {
        if (!link?.type.endsWith("/slide"))
          throw new Error("Missing slide relationship.");
        const path = internalPath("ppt/presentation.xml", link.target);
        const slide = parts.get(path);
        if (!slide || !/^ppt\/slides\/slide\d+\.xml$/.test(path))
          throw new Error("Slide text part is missing.");
        let content = visibleText(xmlDocument(slide));
        const relPath = path.replace(/\/([^/]+)$/, "/_rels/$1.rels");
        try {
          const note = [...relationships(parts, relPath).values()].find((r) =>
            r.type.endsWith("/notesSlide"),
          );
          if (note) {
            const noteXml = parts.get(internalPath(path, note.target));
            if (!noteXml) throw new Error("Speaker notes are missing.");
            const notes = notesText(noteXml);
            if (notes) {
              content += `${content ? "\n\n" : ""}Speaker notes:\n${notes}`;
              notesRead++;
            }
          }
        } catch {
          warnings++;
        }
        if (!content.trim()) emptySlides++;
        append(`Slide ${index + 1}`, content, index + 1);
        slidesRead++;
      } catch {
        warnings++;
      }
    }
    truncated ||= slidesRead < ids.length;
    coverage = {
      truncated,
      slidesRead,
      totalSlides: ids.length,
      emptySlides,
      note: `${slidesRead} of ${ids.length} slides read in presentation order; ${notesRead} with extracted speaker notes; ${emptySlides} without extractable text.${warnings ? ` ${warnings} slide/notes parts could not be read.` : ""}${truncated ? " Extraction stopped at a safety limit (150 slides / 500,000 characters), or a slide was unavailable." : ""} Text only: images, charts, SmartArt, equations, media and animations are not interpreted; drawing order may differ from visual reading order. No OCR.`,
    };
  }
  return {
    text: nonempty ? text : "",
    chunks: nonempty ? chunks : [],
    status: nonempty
      ? truncated || warnings
        ? "partial"
        : "ready"
      : "pending",
    coverage,
    parserVersion: "ooxml-text-v1/fflate-0.8.3",
  };
}
export async function parseOffice(
  file: File,
  kind: "word" | "slides",
  progress: (message: string) => void,
): Promise<ExtractedOffice> {
  const buffer = await readFileBytes(file);
  const worker = new Worker(new URL("./office.worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    const parts = await new Promise<OfficePart[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(
          new Error(
            "Office parsing stopped after 30 seconds. Export a smaller file and retry.",
          ),
        );
      }, 30_000);
      worker.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Local Office worker failed. Reload and retry."));
      };
      worker.onmessage = (
        event: MessageEvent<{ parts?: OfficePart[]; error?: string }>,
      ) => {
        clearTimeout(timer);
        event.data.error
          ? reject(new Error(event.data.error))
          : resolve(event.data.parts ?? []);
      };
      worker.postMessage({ buffer, kind }, [buffer]);
    });
    return extractOfficeParts(parts, kind, progress);
  } finally {
    worker.terminate();
  }
}
