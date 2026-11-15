import { fileKind } from "./file-types.ts";
import { relativePath } from "./paths.ts";

export type FolderFile = { file: File; relativePath: string };
export type FolderScan = {
  files: FolderFile[];
  issues: string[];
  ignored: number;
  limited: boolean;
  unreadable?: { relativePath: string; reason: string }[];
};
export type FolderEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (
    success: (file: File) => void,
    error: (error: unknown) => void,
  ) => void;
  createReader?: () => {
    readEntries(
      success: (entries: FolderEntry[]) => void,
      error: (error: unknown) => void,
    ): void;
  };
};
export type FolderHandle = {
  kind: "file" | "directory";
  name: string;
  getFile?: () => Promise<File>;
  values?: () => AsyncIterableIterator<FolderHandle>;
};
function handleEntry(handle: FolderHandle, signal: AbortSignal): FolderEntry {
  return {
    name: handle.name,
    isFile: handle.kind === "file",
    isDirectory: handle.kind === "directory",
    ...(handle.kind === "file"
      ? {
          file(success: (file: File) => void, error: (error: unknown) => void) {
            handle.getFile!().then(success, error);
          },
        }
      : {
          createReader() {
            const iterator = handle.values!();
            return {
              readEntries(
                success: (entries: FolderEntry[]) => void,
                error: (error: unknown) => void,
              ) {
                void (async () => {
                  const entries: FolderEntry[] = [];
                  for (let i = 0; i < 100; i++) {
                    signal.throwIfAborted();
                    const next = await iterator.next();
                    if (next.done) break;
                    entries.push(handleEntry(next.value, signal));
                  }
                  success(entries);
                })().catch(error);
              },
            };
          },
        }),
  };
}
export async function resolveDroppedEntries(
  legacy: (FolderEntry | null)[],
  pending: Promise<FolderHandle | null>[],
  signal: AbortSignal,
): Promise<FolderEntry[]> {
  const handles = await callback<(FolderHandle | null)[]>((success, error) => {
    Promise.all(pending).then(success, error);
  }, signal);
  return legacy
    .map((entry, index) => {
      const handle = handles[index];
      const supported =
        handle?.kind === "file"
          ? typeof handle.getFile === "function"
          : handle?.kind === "directory" && typeof handle.values === "function";
      return supported ? handleEntry(handle!, signal) : entry;
    })
    .filter((entry): entry is FolderEntry => !!entry);
}
export const MAX_FOLDER_FILES = 1000;
const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".venv",
  "venv",
  "__pycache__",
]);
const ignoredFiles = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
export function ignoredPath(path: string): boolean {
  const parts = path.split("/");
  return (
    parts
      .slice(0, -1)
      .some((part) => ignoredDirectories.has(part.toLowerCase())) ||
    ignoredFiles.has(parts.at(-1)!.toLowerCase())
  );
}
function callback<T>(
  start: (success: (value: T) => void, error: (error: unknown) => void) => void,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      finish(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(
      () => finish(new Error("Reading a folder entry timed out.")),
      10_000,
    );
    let complete = false;
    function finish(error?: unknown, value?: T) {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value!);
    }
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    try {
      start(
        (value) => finish(undefined, value),
        (error) => finish(error),
      );
    } catch (error) {
      finish(error);
    }
  });
}
export async function scanFolderEntries(
  roots: FolderEntry[],
  signal: AbortSignal,
  progress: (count: number) => void,
): Promise<FolderScan> {
  const result: FolderScan = {
    files: [],
    unreadable: [],
    issues: [],
    ignored: 0,
    limited: false,
  };
  let visited = 0,
    stopped = false;
  const started = Date.now();
  const visit = async (entry: FolderEntry, prefix: string) => {
    signal.throwIfAborted();
    if (stopped) return;
    if (
      ++visited > 5000 ||
      result.files.length + (result.unreadable?.length ?? 0) >=
        MAX_FOLDER_FILES ||
      Date.now() - started > 60_000
    ) {
      stopped = true;
      result.limited = true;
      result.issues.push(
        "Scan stopped at a safety limit (1,000 files / 5,000 entries / 60 seconds). Choose smaller subfolders to include the remainder.",
      );
      return;
    }
    let path: string;
    try {
      path = relativePath(`${prefix}${entry.name}`);
    } catch {
      result.issues.push(
        "An invalid or excessively deep folder path was skipped.",
      );
      return;
    }
    if (
      (entry.isDirectory && ignoredDirectories.has(entry.name.toLowerCase())) ||
      (entry.isFile && ignoredFiles.has(entry.name.toLowerCase()))
    ) {
      result.ignored++;
      return;
    }
    try {
      if (entry.isFile && entry.file) {
        const file = await callback<File>(
          (success, error) => entry.file!(success, error),
          signal,
        );
        result.files.push({ file, relativePath: path });
        progress(result.files.length);
      } else if (entry.isDirectory && entry.createReader) {
        const reader = entry.createReader();
        // Chromium returns directory entries in pages, often only 100 at a time.
        while (!stopped) {
          const entries = await callback<FolderEntry[]>(
            (success, error) => reader.readEntries(success, error),
            signal,
          );
          if (!entries.length) break;
          for (const child of entries) {
            await visit(child, `${path}/`);
            if (stopped) break;
          }
        }
      } else result.issues.push(`Could not read ${path}.`);
    } catch (error) {
      signal.throwIfAborted();
      if (entry.isFile)
        result.unreadable!.push({
          relativePath: path,
          reason:
            "Browser could not access this file. It may be unavailable, or its full Windows path may be too long. Try a shorter filename/path or an available local copy, then select it again.",
        });
      result.issues.push(
        `Could not read ${path}. ${error instanceof Error ? error.message : "Access was denied or the file moved."}`,
      );
    }
  };
  for (const root of roots) {
    await visit(root, "");
    if (stopped) break;
  }
  result.files.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }),
  );
  return result;
}
export function scanPickedFolder(files: File[]): FolderScan {
  const result: FolderScan = {
    files: [],
    issues: [],
    ignored: 0,
    limited: files.length > MAX_FOLDER_FILES,
  };
  if (result.limited)
    result.issues.push(
      "Only the first 1,000 selected files are previewed. Choose smaller subfolders for the remainder.",
    );
  for (const file of files.slice(0, MAX_FOLDER_FILES)) {
    try {
      const path = relativePath(file.webkitRelativePath || file.name);
      if (ignoredPath(path)) {
        result.ignored++;
        continue;
      }
      result.files.push({ file, relativePath: path });
    } catch {
      result.issues.push(
        "An invalid or excessively deep folder path was skipped.",
      );
    }
  }
  result.files.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }),
  );
  return result;
}
export type FolderItem = FolderFile & {
  blocked?: string;
  existing: boolean;
  possibleDuplicate: boolean;
  unreadable?: boolean;
};
export function planFolder(
  scan: FolderScan,
  existing: { name: string; size: number; relativePath?: string }[],
): FolderItem[] {
  const seen = new Set<string>();
  const inputs = [
    ...scan.files.map((item) => ({
      ...item,
      unreadable: false,
      readError: "",
    })),
    ...(scan.unreadable ?? []).map((item) => ({
      file: new File([], item.relativePath.split("/").pop()!),
      relativePath: item.relativePath,
      unreadable: true,
      readError: item.reason,
    })),
  ].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }),
  );
  return inputs.map((item) => {
    const kind = fileKind(item.file.name);
    let blocked = item.unreadable
      ? item.readError
      : item.file.size === 0
        ? "Empty or unreadable file (browser reported 0 bytes). For long Windows paths, try a shorter filename/path."
        : kind === "unsupported"
          ? "Unsupported file type"
          : item.file.size >
              (kind === "pdf" || kind === "word" || kind === "slides"
                ? 20_000_000
                : 2_000_000)
            ? "Exceeds per-file size limit"
            : undefined;
    if (seen.has(item.relativePath))
      blocked = "Duplicate relative path in this selection";
    seen.add(item.relativePath);
    return {
      ...item,
      blocked,
      existing: existing.some((d) => d.relativePath === item.relativePath),
      possibleDuplicate: existing.some(
        (d) =>
          d.relativePath === item.relativePath ||
          (d.name === item.file.name && d.size === item.file.size),
      ),
    };
  });
}
export function folderBatches<T extends { size: number }>(files: T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [],
    bytes = 0;
  for (const file of files) {
    if (file.size > 50_000_000)
      throw new Error("A file exceeds the batch size limit.");
    if (
      current.length &&
      (current.length >= 30 || bytes + file.size > 50_000_000)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  if (current.length) batches.push(current);
  return batches;
}
