export const IMPORT_STATUS_KEY = "document-assistant-import-session-v1";
export type ImportStatus = {
  version: 1;
  id: string;
  planned: number;
  saved: number;
  phase: "reading" | "saving" | "analyzing" | "complete" | "stopped" | "error";
  message: string;
};
type StatusStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
// Counts and generic diagnostics only: no paths, names, bodies, handles or credentials.
// Per-tab session storage survives refresh without mixing concurrent tabs' reports.
export function readImportStatus(
  storage?: StatusStorage,
): ImportStatus | undefined {
  try {
    const raw = (storage ?? sessionStorage).getItem(IMPORT_STATUS_KEY);
    if (!raw || raw.length > 3000) return;
    const value = JSON.parse(raw);
    if (
      value?.version !== 1 ||
      typeof value.id !== "string" ||
      !value.id ||
      value.id.length > 100 ||
      !Number.isSafeInteger(value.planned) ||
      value.planned < 1 ||
      value.planned > 500 ||
      !Number.isSafeInteger(value.saved) ||
      value.saved < 0 ||
      value.saved > value.planned ||
      ![
        "reading",
        "saving",
        "analyzing",
        "complete",
        "stopped",
        "error",
      ].includes(value.phase) ||
      typeof value.message !== "string" ||
      value.message.length > 600
    )
      return;
    return value as ImportStatus;
  } catch {
    return;
  }
}
export function writeImportStatus(
  value: ImportStatus,
  storage?: StatusStorage,
) {
  try {
    const { version, id, planned, saved, phase, message } = value;
    (storage ?? sessionStorage).setItem(
      IMPORT_STATUS_KEY,
      JSON.stringify({ version, id, planned, saved, phase, message }),
    );
  } catch {
    /* Saving documents does not depend on this optional report. */
  }
}
export function clearImportStatus(storage?: StatusStorage) {
  try {
    (storage ?? sessionStorage).removeItem(IMPORT_STATUS_KEY);
  } catch {
    /* Storage may be blocked. */
  }
}
