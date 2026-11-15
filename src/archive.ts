import { makeBackup, parseBackup } from "./backup.ts";
import { fullWorkspace } from "./storage.ts";
import type {
  Library,
  ReviewEvent,
  PreferenceRule,
  Workspace,
} from "./workspace";
export type Archive = {
  workspace: Workspace;
  events: ReviewEvent[];
  rules: PreferenceRule[];
};
export async function exportArchive(library: Library): Promise<string> {
  const legacy = JSON.parse(makeBackup(await fullWorkspace(library)));
  const serialized = JSON.stringify({
    ...legacy,
    version: 2,
    events: library.events,
    rules: library.rules,
  });
  if (serialized.length > 60_000_000)
    throw new Error(
      "Backup exceeds this preview’s 60 MB text-format limit. Nothing was exported; keep the library intact and ask for a larger-library export path.",
    );
  return serialized;
}
export function importArchive(text: string): Archive {
  if (text.length > 60_000_000)
    throw new Error("Backup exceeds the 60 MB text limit.");
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid backup JSON. Nothing changed.");
  }
  if (!value || (value.version !== 1 && value.version !== 2))
    throw new Error("Unsupported backup version.");
  const workspace = parseBackup(JSON.stringify({ ...value, version: 1 }));
  if (value.version === 1) return { workspace, events: [], rules: [] };
  if (
    !Array.isArray(value.events) ||
    value.events.length > 10_000 ||
    !Array.isArray(value.rules) ||
    value.rules.length > 200
  )
    throw new Error("Invalid backup memory records.");
  const ids = new Set(workspace.documents.map((document) => document.id));
  const categories = new Set(
    workspace.categories.map((category) => category.id),
  );
  const events = value.events.map((event: ReviewEvent) => {
    if (
      !event ||
      typeof event.id !== "string" ||
      event.id.length > 100 ||
      typeof event.documentId !== "string" ||
      !["confirm", "change", "skip", "undo"].includes(event.action) ||
      typeof event.quote !== "string" ||
      event.quote.length > 320 ||
      typeof event.createdAt !== "string" ||
      event.createdAt.length > 100 ||
      typeof event.categoryVersion !== "string" ||
      event.categoryVersion.length > 60_000 ||
      typeof event.active !== "boolean" ||
      typeof event.localOnly !== "boolean" ||
      (event.categoryId !== null &&
        (typeof event.categoryId !== "string" ||
          (event.active && !categories.has(event.categoryId)))) ||
      (event.previousCategoryId !== null &&
        typeof event.previousCategoryId !== "string")
    )
      throw new Error("Invalid backup review history.");
    return {
      id: event.id,
      documentId: event.documentId,
      action: event.action,
      categoryId: event.categoryId,
      previousCategoryId: event.previousCategoryId,
      quote: event.quote,
      createdAt: event.createdAt,
      categoryVersion: event.categoryVersion,
      active: event.active && ids.has(event.documentId),
      localOnly: true,
    };
  });
  const rules = value.rules.map((rule: PreferenceRule) => {
    if (
      !rule ||
      typeof rule.id !== "string" ||
      rule.id.length > 100 ||
      typeof rule.phrase !== "string" ||
      rule.phrase.trim().length < 3 ||
      rule.phrase.length > 120 ||
      !categories.has(rule.categoryId) ||
      !Array.isArray(rule.sourceIds) ||
      rule.sourceIds.length > 500 ||
      rule.sourceIds.some((id) => typeof id !== "string") ||
      typeof rule.active !== "boolean" ||
      typeof rule.localOnly !== "boolean" ||
      typeof rule.createdAt !== "string"
    )
      throw new Error("Invalid backup rule.");
    return {
      id: rule.id,
      phrase: rule.phrase,
      categoryId: rule.categoryId,
      sourceIds: rule.sourceIds,
      active: rule.active && rule.sourceIds.every((id) => ids.has(id)),
      localOnly: true,
      createdAt: rule.createdAt,
    };
  });
  if (
    new Set(events.map((event) => event.id)).size !== events.length ||
    new Set(rules.map((rule) => rule.id)).size !== rules.length
  )
    throw new Error("Duplicate backup memory IDs.");
  return { workspace, events, rules };
}
