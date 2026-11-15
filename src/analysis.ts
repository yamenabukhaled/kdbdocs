import {
  isLocalOnly,
  type Body,
  type Chunk,
  type DocumentMeta,
  type Library,
  type ReviewEvent,
} from "./workspace.ts";
const categoryKey = (library: Library, id: string | null) => {
  const category = library.categories.find((item) => item.id === id);
  return category ? `${category.id}:${category.version ?? 0}` : "";
};
/** Bounded sample of a long document: start, middle and end (max 8,000 characters). */
export function excerptRanges(body: Body): Chunk[] {
  const length = body.text.length;
  const middleStart = Math.max(
    4000,
    Math.min(Math.floor(length / 2) - 1000, length - 4000),
  );
  const ranges =
    length <= 8000
      ? [{ start: 0, end: length }]
      : [
          { start: 0, end: 4000 },
          {
            start: middleStart,
            end: middleStart + 2000,
          },
          { start: length - 2000, end: length },
        ];
  return ranges
    .map((range) => ({
      ...range,
      page: body.chunks.find(
        (chunk) => range.start >= chunk.start && range.start < chunk.end,
      )?.page,
      slide: body.chunks.find(
        (chunk) => range.start >= chunk.start && range.start < chunk.end,
      )?.slide,
    }))
    .filter((range) => range.end > range.start);
}
export function reviewEvent(
  library: Library,
  document: DocumentMeta,
  action: ReviewEvent["action"],
  categoryId: string | null,
  quote: string,
): ReviewEvent {
  return {
    id: crypto.randomUUID(),
    documentId: document.id,
    action,
    categoryId: action === "skip" ? null : categoryId,
    previousCategoryId: document.categoryId,
    createdAt: new Date().toISOString(),
    active: !!categoryId && action !== "skip" && action !== "undo",
    localOnly:
      isLocalOnly(library, document) ||
      !!library.categories.find((category) => category.id === categoryId)
        ?.localOnly,
    categoryVersion: categoryKey(library, categoryId),
    quote: quote.slice(0, 320),
  };
}
