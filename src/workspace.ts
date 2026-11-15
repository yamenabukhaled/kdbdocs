export type Category = {
  id: string;
  name: string;
  description: string;
  examples: string;
  localOnly: boolean;
  version?: number;
  proposed?: boolean;
  proposalSource?: string;
  proposalQuote?: string;
};
export type Coverage = {
  pagesRead?: number;
  totalPages?: number;
  emptyPages?: number;
  slidesRead?: number;
  totalSlides?: number;
  emptySlides?: number;
  truncated: boolean;
  note: string;
};
export type DocumentRecord = {
  id: string;
  name: string;
  size: number;
  relativePath?: string;
  importedAt: string;
  text: string;
  status: "ready" | "partial" | "pending" | "error";
  coverage: Coverage;
  localOnly: boolean;
  categoryId: string | null;
  chunks?: Chunk[];
  parserVersion?: string;
};
export type Chunk = {
  start: number;
  end: number;
  page?: number;
  slide?: number;
};
export type Suggestion = {
  outdated?: boolean;
  categoryId: string | null;
  reason: string;
  quote: string;
  needsIntent: boolean;
  source: "local" | "cloud";
  signature: string;
  createdAt: string;
  ranges: Chunk[];
  inputCharacters: number;
  elapsedMs: number;
  exampleIds: string[];
  ruleIds: string[];
};
export type DocumentMeta = Omit<DocumentRecord, "text"> & {
  importId?: string;
  characters: number;
  contentHash: string;
  preview?: string;
  suggestion?: Suggestion;
  analysisState?: "pending" | "review" | "confirmed" | "skipped" | "error";
  analysisError?: string;
  /** On-device summary used for planning; tied to the content hash. */
  summary?: FileSummary;
  /** Collections the user rejected for this file in a plan; not suggested again. */
  rejectedCategoryIds?: string[];
};
export type FileSummary = {
  text: string;
  topics: string[];
  contentHash: string;
  sensitive: boolean;
  /** Types of personal data found (never the data itself). */
  reasons: string[];
  version: string;
  /** Dated items the device found (deadlines, bills, trips); stays local. */
  dates?: { what: string; date: string }[];
};
export type PlanCollection = {
  /** "c:<categoryId>" for existing collections, "new:<n>" for proposed ones. */
  key: string;
  name: string;
  description: string;
  existingId?: string;
};
export type PlanPlacement = {
  documentId: string;
  collectionKey: string | null;
  confidence: "high" | "low";
  route: "cloud" | "local";
};
export type PlanQuestion = {
  question: string;
  documentIds: string[];
  options: {
    label: string;
    collectionKey: string | null;
    /** General rule this answer implies, saved as a preference when chosen. */
    preference?: string;
  }[];
};
/** A question shown inline after files were already filed by best guess. */
export type PendingQuestion = {
  id: string;
  question: string;
  documentIds: string[];
  options: {
    label: string;
    collectionId: string | null;
    /** A proposed collection nothing was filed into yet; created if chosen. */
    newCollection?: { name: string; description: string };
    preference?: string;
  }[];
  createdAt: string;
};
/** A sorting preference learned from an answered question. Sent with later plans. */
export type Preference = {
  id: string;
  text: string;
  collectionId: string | null;
  createdAt: string;
};
export type OrganizePlan = {
  id: string;
  createdAt: string;
  collections: PlanCollection[];
  placements: PlanPlacement[];
  questions: PlanQuestion[];
};
export type ReviewEvent = {
  id: string;
  documentId: string;
  action: "confirm" | "change" | "skip" | "undo";
  categoryId: string | null;
  previousCategoryId: string | null;
  createdAt: string;
  active: boolean;
  localOnly: boolean;
  categoryVersion: string;
  quote: string;
};
export type PreferenceRule = {
  id: string;
  phrase: string;
  categoryId: string;
  sourceIds: string[];
  localOnly: boolean;
  active: boolean;
  createdAt: string;
};
export type AnalysisJob = {
  id: string;
  documentId: string;
  state: "queued" | "running" | "done" | "error" | "cancelled";
  error?: string;
  createdAt: string;
};
export type Library = {
  version: 2;
  revision: number;
  globalLocalOnly: boolean;
  personalized?: boolean;
  documents: DocumentMeta[];
  categories: Category[];
  events: ReviewEvent[];
  rules: PreferenceRule[];
  jobs: AnalysisJob[];
  /** Questions about files already filed by best guess; excluded from backups. */
  pendingQuestions?: PendingQuestion[];
  /** Preferences learned from answers; used as context for later plans. */
  preferences?: Preference[];
  /** Explicit one-time yes to cloud sorting of device summaries. */
  cloudSorting?: boolean;
  /** "Coming up" items the person dismissed (document|date|what). */
  dismissedDates?: string[];
};
export type Body = {
  id: string;
  text: string;
  chunks: Chunk[];
  parserVersion: string;
};
export type Workspace = {
  version: 1;
  revision: number;
  globalLocalOnly: boolean;
  documents: DocumentRecord[];
  categories: Category[];
};
export const emptyWorkspace = (): Workspace => ({
  version: 1,
  revision: 0,
  globalLocalOnly: true,
  documents: [],
  categories: [],
});
export function isLocalOnly(
  workspace: Pick<Workspace, "globalLocalOnly" | "categories">,
  document: Pick<DocumentRecord, "localOnly" | "categoryId">,
): boolean {
  const category = workspace.categories.find(
    (item) => item.id === document.categoryId,
  );
  return (
    workspace.globalLocalOnly ||
    document.localOnly ||
    !!category?.localOnly ||
    !!category?.proposalSource
  );
}
export function categoryName(
  value: string,
  categories: Category[],
  exceptId?: string,
): string {
  const name = value.trim();
  if (!name || name.length > 60)
    throw new Error("Use a category name between 1 and 60 characters.");
  if (
    categories.some(
      (item) =>
        item.id !== exceptId && item.name.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new Error("A category with that name already exists.");
  return name;
}
export function removeCategory(workspace: Workspace, id: string): Workspace {
  return {
    ...workspace,
    categories: workspace.categories.filter((item) => item.id !== id),
    documents: workspace.documents.map((document) =>
      document.categoryId === id
        ? { ...document, categoryId: null, localOnly: true }
        : document,
    ),
  };
}
