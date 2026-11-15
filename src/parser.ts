import type { DocumentRecord } from "./workspace";
import { fileKind, extension } from "./file-types.ts";
import { readFileBytes } from "./file-read.ts";
export const MAX_TEXT = 500_000;
export const MAX_PAGES = 150;
export const MAX_BATCH_BYTES = 50_000_000;
export async function parseFile(
  file: File,
  progress: (message: string) => void,
): Promise<DocumentRecord> {
  const document: DocumentRecord = {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    importedAt: new Date().toISOString(),
    text: "",
    status: "pending",
    // Cloud planning is still blocked by the workspace switch, the consent
    // screen and the sensitivity screen; this flag is for files the user protects.
    localOnly: false,
    categoryId: null,
    parserVersion: "unparsed-v1",
    chunks: [],
    coverage: { truncated: false, note: "Not parsed. AI analysis: none." },
  };
  const kind = fileKind(file.name);
  const pdf = kind === "pdf";
  const office = kind === "word" || kind === "slides";
  if (kind === "unsupported") {
    document.coverage.note = ["doc", "ppt", "docm", "pptm"].includes(
      extension(file.name),
    )
      ? "Unsupported legacy or macro-enabled Office file. Save a .docx or .pptx copy locally and import that. Macros are never run."
      : "Unsupported file type. Import PDF, .docx, .pptx, text/data or supported source code. Images/fonts/binaries and notebook .ipynb extraction are not supported; no contents were read.";
    return document;
  }
  if (file.size > (pdf || office ? 20_000_000 : 2_000_000)) {
    document.coverage.note = `File exceeds the ${pdf || office ? "20 MB PDF/Office" : "2 MB text/code"} import limit. No contents were read.`;
    return document;
  }
  if (office) {
    try {
      const { parseOffice } = await import("./office");
      Object.assign(document, await parseOffice(file, kind, progress));
    } catch (error) {
      document.status = "error";
      document.coverage = {
        truncated: true,
        note:
          error instanceof Error
            ? error.message
            : "Office file could not be read. Re-save an unlocked .docx/.pptx copy and retry.",
      };
      document.parserVersion = "ooxml-text-v1/fflate-0.8.3";
    }
    return document;
  }
  if (!pdf) {
    document.parserVersion = "text-code-v3";
    try {
      const bytes = new Uint8Array(await readFileBytes(file));
      const encoding =
        bytes[0] === 0xff && bytes[1] === 0xfe
          ? "utf-16le"
          : bytes[0] === 0xfe && bytes[1] === 0xff
            ? "utf-16be"
            : "utf-8";
      const text = new TextDecoder(encoding).decode(bytes);
      if (
        text.includes("\0") ||
        (text.match(/[\x01-\x08\x0B\x0E-\x1F]/g)?.length ?? 0) >
          Math.max(4, text.length / 100)
      )
        throw new Error(
          "File appears to contain binary data. Only text-based source/data files are supported; nothing is executed.",
        );
      document.text = text.slice(0, MAX_TEXT);
      document.chunks = document.text
        ? [{ start: 0, end: document.text.length }]
        : [];
      document.coverage.truncated = text.length > MAX_TEXT;
      document.status = document.coverage.truncated
        ? "partial"
        : text.trim()
          ? "ready"
          : "pending";
      document.coverage.note = `${text.length > MAX_TEXT ? `Extraction capped at ${MAX_TEXT.toLocaleString()} of ${text.length.toLocaleString()} characters.` : `Entire file decoded as ${encoding.toUpperCase()} text.`}${kind === "code" ? " Source code is read as text only, never executed or compiled. Referenced files/packages are not loaded." : " Text/data only; markup is never rendered as active content."}${text.includes("\uFFFD") ? " Replacement characters found: the file may use a different encoding." : ""}${text.trim() ? "" : " No non-whitespace text found."}`;
    } catch (error) {
      document.status = "error";
      document.coverage.note =
        error instanceof Error
          ? error.message
          : "The text file could not be read. Reimport the original to retry.";
    }
    return document;
  }
  // Lazy, same-origin worker. No PDF URL, remote font, CMap, or content upload is used.
  document.parserVersion = "pdfjs-6.5.438/text-utf8-v2";
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  const task = getDocument({
    data: new Uint8Array(await readFileBytes(file)),
    useSystemFonts: true,
    useWorkerFetch: false,
    disableFontFace: true,
    stopAtErrors: true,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void task.destroy();
  }, 30_000);
  let pagesRead = 0;
  let emptyPages = 0;
  let totalPages = 0;
  try {
    const pdfDocument = await task.promise;
    totalPages = pdfDocument.numPages;
    for (
      let pageNumber = 1;
      pageNumber <= Math.min(MAX_PAGES, totalPages);
      pageNumber++
    ) {
      progress(`Reading PDF page ${pageNumber} of ${totalPages}…`);
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("")
        .trim();
      if (!text) emptyPages++;
      const combined = `${document.text}${document.text ? "\n\n" : ""}[Page ${pageNumber}]\n${text}`;
      const start = document.text.length + (document.text ? 2 : 0);
      document.text = combined.slice(0, MAX_TEXT);
      document.chunks!.push({
        start,
        end: document.text.length,
        page: pageNumber,
      });
      pagesRead++;
      page.cleanup();
      if (combined.length >= MAX_TEXT) {
        document.coverage.truncated = true;
        break;
      }
    }
    document.coverage.truncated ||= pagesRead < totalPages;
    document.status =
      emptyPages === pagesRead
        ? "pending"
        : document.coverage.truncated || emptyPages > 0
          ? "partial"
          : "ready";
    document.coverage.note = `${pagesRead} of ${totalPages} pages read.${document.coverage.truncated ? ` Extraction stopped at a safety limit (${MAX_PAGES} pages / ${MAX_TEXT.toLocaleString()} characters).` : ""} ${emptyPages} pages had no extractable text. Images and handwriting are not read; OCR is not implemented. Reading order and tables may differ from the PDF.`;
    if (emptyPages === pagesRead) {
      document.text = "";
      document.chunks = [];
    }
  } catch (error) {
    document.status = pagesRead ? "partial" : "error";
    document.coverage.truncated = true;
    document.coverage.note = timedOut
      ? "PDF parsing stopped after 30 seconds. Reimport a smaller PDF to retry."
      : error instanceof Error && error.name === "PasswordException"
        ? "Password-protected PDF: unlock a copy locally and reimport. Password entry is not implemented."
        : "PDF could not be fully parsed. It may be damaged or unsupported. Reimport the original to retry.";
    document.coverage.note += ` ${pagesRead} of ${totalPages || "an unknown number of"} pages read before stopping.`;
  } finally {
    document.coverage.pagesRead = pagesRead;
    document.coverage.totalPages = totalPages;
    document.coverage.emptyPages = emptyPages;
    clearTimeout(timer);
    await task.destroy();
  }
  return document;
}
