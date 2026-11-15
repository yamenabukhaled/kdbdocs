import type { Workspace, Category, DocumentRecord, Chunk } from "./workspace";
import { relativePath } from "./paths.ts";

const fail = () => {
  throw new Error("Invalid or incompatible backup. Nothing was changed.");
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
const string = (value: unknown, max: number) =>
  typeof value === "string" && value.length <= max ? value : fail();
const boolean = (value: unknown) =>
  typeof value === "boolean" ? value : fail();
const number = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail();
export function validateWorkspace(value: unknown): Workspace {
  const data = object(value);
  if (
    data.version !== 1 ||
    !Array.isArray(data.documents) ||
    data.documents.length > 500 ||
    !Array.isArray(data.categories) ||
    data.categories.length > 20
  )
    fail();
  const categories: Category[] = (data.categories as unknown[]).map((value) => {
    const item = object(value);
    return {
      id: string(item.id, 100),
      name: string(item.name, 60),
      description: string(item.description, 2000),
      examples: string(item.examples, 4000),
      localOnly: boolean(item.localOnly),
      ...(item.version === undefined ? {} : { version: number(item.version) }),
      ...(item.proposed === undefined
        ? {}
        : { proposed: boolean(item.proposed) }),
      ...(item.proposalSource === undefined
        ? {}
        : { proposalSource: string(item.proposalSource, 100) }),
      ...(item.proposalQuote === undefined
        ? {}
        : { proposalQuote: string(item.proposalQuote, 160) }),
    };
  });
  if (
    new Set(categories.map((item) => item.id)).size !== categories.length ||
    new Set(categories.map((item) => item.name.trim().toLowerCase())).size !==
      categories.length ||
    categories.some((item) => !item.id || !item.name.trim())
  )
    fail();
  const documents: DocumentRecord[] = (data.documents as unknown[]).map(
    (value) => {
      const item = object(value);
      const coverage = object(item.coverage);
      if (
        !["ready", "partial", "pending", "error"].includes(String(item.status))
      )
        fail();
      const categoryId =
        item.categoryId === null ? null : string(item.categoryId, 100);
      if (
        categoryId !== null &&
        !categories.some((category) => category.id === categoryId)
      )
        fail();
      return {
        id: string(item.id, 100),
        name: string(item.name, 1000),
        ...(item.relativePath === undefined
          ? {}
          : { relativePath: relativePath(string(item.relativePath, 1000)) }),
        size: number(item.size),
        importedAt: string(item.importedAt, 100),
        text: string(item.text, 500_000),
        status: item.status as DocumentRecord["status"],
        localOnly: boolean(item.localOnly),
        categoryId,
        ...(item.parserVersion === undefined
          ? {}
          : { parserVersion: string(item.parserVersion, 100) }),
        ...(item.chunks === undefined
          ? {}
          : { chunks: validateChunks(item.chunks, String(item.text).length) }),
        coverage: {
          truncated: boolean(coverage.truncated),
          note: string(coverage.note, 4000),
          ...(coverage.pagesRead === undefined
            ? {}
            : { pagesRead: number(coverage.pagesRead) }),
          ...(coverage.totalPages === undefined
            ? {}
            : { totalPages: number(coverage.totalPages) }),
          ...(coverage.emptyPages === undefined
            ? {}
            : { emptyPages: number(coverage.emptyPages) }),
          ...(coverage.slidesRead === undefined
            ? {}
            : { slidesRead: number(coverage.slidesRead) }),
          ...(coverage.totalSlides === undefined
            ? {}
            : { totalSlides: number(coverage.totalSlides) }),
          ...(coverage.emptySlides === undefined
            ? {}
            : { emptySlides: number(coverage.emptySlides) }),
        },
      };
    },
  );
  if (
    new Set(documents.map((item) => item.id)).size !== documents.length ||
    documents.some((item) => !item.id)
  )
    fail();
  return {
    version: 1,
    revision: number(data.revision),
    globalLocalOnly: boolean(data.globalLocalOnly),
    documents,
    categories,
  };
}
function validateChunks(value: unknown, length: number): Chunk[] {
  if (!Array.isArray(value) || value.length > 1000) return fail();
  return value.map((value) => {
    const chunk = object(value);
    const start = number(chunk.start);
    const end = number(chunk.end);
    if (start > end || end > length) return fail();
    return {
      start,
      end,
      ...(chunk.page === undefined ? {} : { page: number(chunk.page) }),
      ...(chunk.slide === undefined ? {} : { slide: number(chunk.slide) }),
    };
  });
}
export function makeBackup(workspace: Workspace) {
  return JSON.stringify({
    format: "document-assistant-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: validateWorkspace(workspace),
  });
}
export function parseBackup(text: string): Workspace {
  if (text.length > 60_000_000)
    throw new Error(
      "Backup exceeds the 60 MB text limit. Nothing was changed.",
    );
  let value: Record<string, unknown>;
  try {
    value = object(JSON.parse(text));
  } catch {
    return fail();
  }
  if (value.format !== "document-assistant-backup" || value.version !== 1)
    return fail();
  return validateWorkspace(value.workspace);
}
export function restorePlan(
  current: Workspace,
  incoming: Workspace,
  mode: "merge" | "replace",
): Workspace {
  if (mode === "replace")
    return {
      ...incoming,
      revision: current.revision,
      globalLocalOnly: true,
      documents: incoming.documents.map((item) => ({
        ...item,
        localOnly: true,
      })),
      categories: incoming.categories.map((item) => ({
        ...item,
        localOnly: true,
      })),
    };
  // Keep current IDs on conflict. Restored copies are explicitly local-only and never overwrite current decisions.
  const categoryIds = new Map<string, string>();
  const categories = [...current.categories];
  for (const category of incoming.categories) {
    const same = categories.find(
      (item) =>
        item.name.trim().toLowerCase() === category.name.trim().toLowerCase(),
    );
    if (same) {
      categoryIds.set(category.id, same.id);
      continue;
    }
    const id = crypto.randomUUID();
    categoryIds.set(category.id, id);
    categories.push({ ...category, id, localOnly: true });
  }
  const documents = [...current.documents];
  for (const document of incoming.documents) {
    if (documents.some((item) => item.id === document.id)) continue;
    documents.push({
      ...document,
      categoryId: document.categoryId
        ? (categoryIds.get(document.categoryId) ?? null)
        : null,
      localOnly: true,
    });
  }
  return validateWorkspace({ ...current, categories, documents });
}
