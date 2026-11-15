import {
  emptyWorkspace,
  type Library,
  type DocumentRecord,
  type DocumentMeta,
  type Body,
  type Workspace,
} from "./workspace.ts";
import { validateWorkspace } from "./backup.ts";
export const DATABASE = "document-assistant-local-v1";
export const emptyLibrary = (): Library => ({
  version: 2,
  revision: 0,
  globalLocalOnly: true,
  personalized: false,
  documents: [],
  categories: [],
  events: [],
  rules: [],
  jobs: [],
});
const stores = [
  "meta",
  "documents",
  "bodies",
  "events",
  "rules",
  "jobs",
  "undo",
] as const;
function split(
  document: DocumentRecord,
  contentHash: string,
): { meta: DocumentMeta; body: Body } {
  const {
    text,
    chunks = text ? [{ start: 0, end: text.length }] : [],
    parserVersion = "legacy-text-v1",
    ...metadata
  } = document;
  return {
    meta: {
      ...metadata,
      characters: text.length,
      preview: text.slice(0, 240),
      contentHash,
      parserVersion,
      analysisState: document.categoryId ? "confirmed" : "pending",
    },
    body: { id: document.id, text, chunks, parserVersion },
  };
}
export async function documentParts(document: DocumentRecord) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(document.text),
  );
  return split(
    document,
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  );
}
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction!;
      stores.forEach((name) => {
        if (!database.objectStoreNames.contains(name))
          database.createObjectStore(name);
      });
      const write = (workspace: Workspace) => {
        transaction.objectStore("meta").put(
          {
            revision: workspace.revision,
            globalLocalOnly: workspace.globalLocalOnly,
            categories: workspace.categories,
          },
          "current",
        );
        for (const document of workspace.documents) {
          const parts = split(document, `legacy:${document.id}`);
          transaction.objectStore("documents").put(parts.meta, document.id);
          transaction.objectStore("bodies").put(parts.body, document.id);
        }
      };
      if (database.objectStoreNames.contains("workspace")) {
        const legacy = transaction.objectStore("workspace").get("current");
        legacy.onsuccess = () => {
          try {
            write(
              legacy.result
                ? validateWorkspace(legacy.result)
                : emptyWorkspace(),
            );
          } catch {
            transaction.abort();
          }
        };
        // Keep the legacy store as a local pre-migration checkpoint. It is never read by normal v2 writes.
      } else write(emptyWorkspace());
    };
    request.onblocked = () => {
      blocked = true;
      reject(
        new Error(
          "Local storage upgrade is blocked. Close other app tabs and reload.",
        ),
      );
    };
    request.onerror = () =>
      reject(
        new Error(
          "Local storage could not be opened or migrated. Existing data was not replaced. Close other app tabs and reload.",
        ),
      );
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
export async function readLibrary(): Promise<Library> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      ["meta", "documents", "events", "rules", "jobs"],
      "readonly",
    );
    const meta = transaction.objectStore("meta").get("current");
    const documents = transaction.objectStore("documents").getAll();
    const events = transaction.objectStore("events").getAll();
    const rules = transaction.objectStore("rules").getAll();
    const jobs = transaction.objectStore("jobs").getAll();
    transaction.oncomplete = () => {
      database.close();
      resolve({
        version: 2,
        personalized: false,
        ...meta.result,
        documents: documents.result,
        events: events.result,
        rules: rules.result,
        jobs: jobs.result,
      });
    };
    transaction.onabort = () => {
      database.close();
      reject(new Error("Could not read local library. Reload to retry."));
    };
  });
}
export async function readBody(id: string): Promise<Body | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("bodies", "readonly");
    const request = transaction.objectStore("bodies").get(id);
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onabort = () => {
      database.close();
      reject(new Error("Could not read saved text."));
    };
  });
}
// Compare per-record values; body text is not loaded or rewritten for metadata changes.
function reconcile(
  store: IDBObjectStore,
  old: { id: string }[],
  next: { id: string }[],
) {
  const previous = new Map(old.map((item) => [item.id, item]));
  const ids = new Set(next.map((item) => item.id));
  old.forEach((item) => {
    if (!ids.has(item.id)) store.delete(item.id);
  });
  next.forEach((item) => {
    if (JSON.stringify(previous.get(item.id)) !== JSON.stringify(item))
      store.put(item, item.id);
  });
}
export async function writeLibrary(
  previous: Library,
  next: Library,
  bodies: Body[] = [],
  remember = true,
  consumeUndo = false,
): Promise<Library> {
  const previousCharacters = previous.documents.reduce(
    (sum, document) => sum + document.characters,
    0,
  );
  const nextCharacters = next.documents.reduce(
    (sum, document) => sum + document.characters,
    0,
  );
  if (nextCharacters > 20_000_000 && nextCharacters > previousCharacters)
    throw new Error(
      "This preview supports 20 million extracted characters per library. Export a backup and remove files before importing more. Existing data is unchanged.",
    );
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([...stores], "readwrite");
    let conflict = false;
    const saved = { ...next, revision: previous.revision + 1 };
    const request = transaction.objectStore("meta").get("current");
    request.onsuccess = () => {
      if ((request.result?.revision ?? 0) !== previous.revision) {
        conflict = true;
        transaction.abort();
        return;
      }
      try {
        transaction.objectStore("meta").put(
          {
            revision: saved.revision,
            globalLocalOnly: saved.globalLocalOnly,
            personalized: saved.personalized ?? false,
            categories: saved.categories,
            pendingQuestions: saved.pendingQuestions ?? [],
            preferences: saved.preferences ?? [],
            cloudSorting: saved.cloudSorting ?? false,
            dismissedDates: saved.dismissedDates ?? [],
          },
          "current",
        );
        for (const field of ["documents", "events", "rules", "jobs"] as const)
          reconcile(
            transaction.objectStore(field),
            previous[field],
            saved[field],
          );
        const undoEntry = {
          library: previous,
          afterRevision: saved.revision,
          bodies: [] as Body[],
        };
        for (const body of bodies) {
          if (
            remember &&
            previous.documents.some((document) => document.id === body.id)
          ) {
            const oldBody = transaction.objectStore("bodies").get(body.id);
            oldBody.onsuccess = () => {
              if (oldBody.result) undoEntry.bodies.push(oldBody.result);
              transaction.objectStore("undo").put(undoEntry, "last");
            };
          }
          transaction.objectStore("bodies").put(body, body.id);
        }
        // Removed bodies are retained only for the one-operation persisted undo, then reclaimed.
        const keep = new Set(
          [...saved.documents, ...(remember ? previous.documents : [])].map(
            (item) => item.id,
          ),
        );
        if (remember) transaction.objectStore("undo").put(undoEntry, "last");
        else if (consumeUndo) transaction.objectStore("undo").delete("last");
        else {
          const existingUndo = transaction.objectStore("undo").get("last");
          existingUndo.onsuccess = () => {
            const entry = existingUndo.result;
            if (entry && entry.afterRevision === previous.revision) {
              entry.library.documents.forEach((document: DocumentMeta) =>
                keep.add(document.id),
              );
              transaction
                .objectStore("undo")
                .put({ ...entry, afterRevision: saved.revision }, "last");
            } else transaction.objectStore("undo").delete("last");
          };
        }
        const cursor = transaction.objectStore("bodies").openKeyCursor();
        cursor.onsuccess = () => {
          if (cursor.result) {
            if (!keep.has(String(cursor.result.key)))
              transaction.objectStore("bodies").delete(cursor.result.key);
            cursor.result.continue();
          }
        };
      } catch {
        transaction.abort();
      }
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(saved);
    };
    transaction.onabort = () => {
      database.close();
      reject(
        new Error(
          conflict
            ? "Another tab changed this workspace. Reload before editing; the attempted change was not saved."
            : "Could not save locally. Storage may be full or unavailable; previous saved data is unchanged.",
        ),
      );
    };
  });
}
export async function undoLibrary(current: Library): Promise<Library> {
  const database = await openDatabase();
  const entry = await new Promise<
    { library: Library; afterRevision: number; bodies?: Body[] } | undefined
  >((resolve, reject) => {
    const transaction = database.transaction("undo", "readonly");
    const request = transaction.objectStore("undo").get("last");
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onabort = () => {
      database.close();
      reject(new Error("Undo could not be read."));
    };
  });
  if (!entry || entry.afterRevision !== current.revision)
    throw new Error("No saved change to undo at this revision.");
  return writeLibrary(
    current,
    {
      ...entry.library,
      events: [
        ...entry.library.events,
        {
          id: crypto.randomUUID(),
          documentId: "",
          action: "undo",
          categoryId: null,
          previousCategoryId: null,
          createdAt: new Date().toISOString(),
          active: false,
          localOnly: true,
          categoryVersion: "",
          quote: "",
        },
      ],
    },
    entry.bodies ?? [],
    false,
    true,
  );
}
export async function fullWorkspace(library: Library): Promise<Workspace> {
  const documents: DocumentRecord[] = [];
  for (const document of library.documents) {
    const body = await readBody(document.id);
    if (!body)
      throw new Error(
        "Saved text is missing. Export was stopped to avoid an incomplete backup.",
      );
    const {
      characters: _characters,
      contentHash: _hash,
      suggestion: _suggestion,
      analysisState: _state,
      analysisError: _error,
      summary: _summary,
      rejectedCategoryIds: _rejected,
      ...metadata
    } = document;
    documents.push({
      ...metadata,
      text: body.text,
      chunks: body.chunks,
      parserVersion: body.parserVersion,
    });
  }
  // Catch concurrent exports without silently mixing revisions.
  if ((await readLibrary()).revision !== library.revision)
    throw new Error("Library changed during export. Try again.");
  return {
    version: 1,
    revision: library.revision,
    globalLocalOnly: library.globalLocalOnly,
    categories: library.categories,
    documents,
  };
}
