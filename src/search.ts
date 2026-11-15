import type { DocumentMeta } from "./workspace.ts";

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase();
const tokens = (value: string) =>
  [...new Set(normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, 32);
export type SearchHit = { score: number; snippet: string };
// Disposable, origin-local cache. Built only on a search action, never on library startup.
// Library storage already caps total extracted text at 20 million characters.
export class ContentSearch {
  private characters = 0;
  private maxCharacters: number;
  constructor(maxCharacters = 40_000_000) {
    this.maxCharacters = maxCharacters;
  }
  private entries = new Map<
    string,
    { hash: string; text: string; normalized: string }
  >();
  prune(documents: DocumentMeta[]) {
    const hashes = new Map(documents.map((d) => [d.id, d.contentHash]));
    for (const [id, entry] of this.entries)
      if (hashes.get(id) !== entry.hash) {
        this.characters -= entry.text.length + entry.normalized.length;
        this.entries.delete(id);
      }
  }
  has(document: DocumentMeta) {
    return this.entries.get(document.id)?.hash === document.contentHash;
  }
  add(document: DocumentMeta, text: string) {
    const previous = this.entries.get(document.id);
    if (previous) {
      this.characters -= previous.text.length + previous.normalized.length;
      this.entries.delete(document.id);
    }
    const normalized = normalize(text);
    const cost = text.length + normalized.length;
    while (this.characters + cost > this.maxCharacters && this.entries.size) {
      const [id, oldest] = this.entries.entries().next().value!;
      this.characters -= oldest.text.length + oldest.normalized.length;
      this.entries.delete(id);
    }
    if (cost > this.maxCharacters) return;
    this.characters += cost;
    this.entries.set(document.id, {
      hash: document.contentHash,
      text,
      normalized,
    });
  }
  find(
    document: DocumentMeta,
    query: string,
    expanded: string[] = [],
  ): SearchHit | null {
    const entry = this.entries.get(document.id);
    const name = normalize(
      `${document.name}${document.summary?.title ? ` ${document.summary.title}` : ""}${document.relativePath ? ` ${document.relativePath}` : ""}`,
    );
    const body = entry?.normalized ?? "";
    const phrase = normalize(query).trim().replace(/^"|"$/g, "");
    const requiredPhrase =
      query.trim().startsWith('"') && query.trim().endsWith('"');
    const terms = tokens(query);
    const whole = name.includes(phrase) || body.includes(phrase);
    const matched = terms.filter((t) => name.includes(t) || body.includes(t));
    const extras = tokens(expanded.join(" ")).filter(
      (t) => !terms.includes(t) && (name.includes(t) || body.includes(t)),
    );
    if (
      !phrase ||
      (requiredPhrase
        ? !whole
        : !whole && matched.length !== terms.length && !extras.length)
    )
      return null;
    const score =
      (whole ? 40 : 0) +
      matched.length * 5 +
      extras.length * 2 +
      (name.includes(phrase) ? 25 : 0);
    const needle = body.includes(phrase)
      ? phrase
      : [...terms, ...extras].find((t) => body.includes(t));
    // Locate in original text independently: normalization can change character offsets.
    const offset = needle
      ? (entry?.text.toLocaleLowerCase().indexOf(needle) ?? -1)
      : -1;
    const start = Math.max(0, offset - 65);
    const snippet = entry
      ? `${start ? "…" : ""}${entry.text.slice(start, start + 230).replace(/\s+/g, " ")}${entry.text.length > start + 230 ? "…" : ""}`
      : "Filename match; extracted text unavailable.";
    return { score, snippet };
  }
}
export function validateSearchTerms(raw: string, source: string): string[] {
  if (source !== "on_device" || raw.length > 2000)
    throw new Error("Invalid local search expansion.");
  const data = JSON.parse(raw);
  if (
    !Array.isArray(data.terms) ||
    data.terms.length > 8 ||
    data.terms.some(
      (t: unknown) => typeof t !== "string" || !t.trim() || t.length > 60,
    )
  )
    throw new Error("Invalid search terms.");
  return [...new Set(data.terms as string[])];
}
