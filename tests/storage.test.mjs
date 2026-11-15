import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  readLibrary,
  readBody,
  writeLibrary,
  undoLibrary,
  DATABASE,
  documentParts,
  fullWorkspace,
} from "../src/storage.ts";

test("v1 migration is lossless, metadata writes never rewrite bodies, stale writes fail, undo persists", async () => {
  const legacy = {
    version: 1,
    revision: 4,
    globalLocalOnly: false,
    categories: [
      {
        id: "c",
        name: "Research",
        description: "intent",
        examples: "",
        localOnly: true,
      },
    ],
    documents: [
      {
        id: "old",
        name: "private.txt",
        size: 6,
        text: "secret",
        status: "ready",
        importedAt: "2026-11-12",
        categoryId: "c",
        localOnly: false,
        coverage: { truncated: false, note: "legacy extraction" },
      },
    ],
  };
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workspace");
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("workspace", "readwrite");
      transaction.objectStore("workspace").put(legacy, "current");
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onabort = reject;
    };
  });
  const migrated = await readLibrary();
  assert.equal(migrated.revision, 4);
  assert.equal(migrated.documents[0].localOnly, false);
  assert.equal(migrated.categories[0].localOnly, true);
  assert.equal("text" in migrated.documents[0], false);
  assert.equal((await readBody("old")).text, "secret");
  const puts = [];
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    puts.push(this.name);
    return original.apply(this, args);
  };
  const saved = await writeLibrary(migrated, {
    ...migrated,
    globalLocalOnly: true,
  });
  IDBObjectStore.prototype.put = original;
  assert.equal(puts.includes("bodies"), false);
  assert.equal((await readBody("old")).text, "secret");
  await assert.rejects(() => writeLibrary(migrated, migrated), /Another tab/);
  const restored = await undoLibrary(await readLibrary());
  assert.equal(restored.globalLocalOnly, false);
  const parts = await documentParts({
    ...legacy.documents[0],
    id: "new",
    text: "new text",
  });
  assert.match(parts.meta.contentHash, /^[a-f0-9]{64}$/);
  const withNew = await writeLibrary(
    restored,
    { ...restored, documents: [...restored.documents, parts.meta] },
    [parts.body],
  );
  const withoutNew = await writeLibrary(withNew, {
    ...withNew,
    documents: withNew.documents.filter((item) => item.id !== "new"),
  });
  const undo = await undoLibrary(withoutNew);
  assert.equal(undo.documents.length, 2);
  assert.equal((await readBody("new")).text, "new text");
  assert.equal(
    (await fullWorkspace(undo)).documents.find((item) => item.id === "old")
      .text,
    "secret",
  );
  const replacement = await documentParts({
    ...legacy.documents[0],
    id: "new",
    text: "overwritten during restore",
  });
  const replaced = await writeLibrary(
    undo,
    {
      ...undo,
      documents: undo.documents.map((document) =>
        document.id === "new" ? replacement.meta : document,
      ),
    },
    [replacement.body],
  );
  assert.equal((await readBody("new")).text, "overwritten during restore");
  const recovered = await undoLibrary(replaced);
  assert.equal(recovered.documents.length, 2);
  assert.equal((await readBody("new")).text, "new text");
  const changedPolicy = await writeLibrary(recovered, {
    ...recovered,
    globalLocalOnly: !recovered.globalLocalOnly,
  });
  const maintenance = await writeLibrary(
    changedPolicy,
    { ...changedPolicy, jobs: [] },
    [],
    false,
  );
  const afterBackgroundWork = await undoLibrary(maintenance);
  assert.equal(afterBackgroundWork.globalLocalOnly, recovered.globalLocalOnly);
});
