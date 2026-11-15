import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readImportStatus,
  writeImportStatus,
  clearImportStatus,
  IMPORT_STATUS_KEY,
} from "../src/import-status.ts";
import { readFileBytes } from "../src/file-read.ts";
test("import reports retain bounded counts/errors across reload without serializing extra document data", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const report = {
    version: 1,
    id: "run",
    planned: 15,
    saved: 1,
    phase: "error",
    message: "Could not save locally.",
  };
  writeImportStatus(
    { ...report, privateBody: "PRIVATE_BODY", fileName: "PRIVATE_NAME" },
    storage,
  );
  assert.deepEqual(readImportStatus(storage), report);
  assert.doesNotMatch(values.get(IMPORT_STATUS_KEY), /PRIVATE/);
  values.set(IMPORT_STATUS_KEY, JSON.stringify({ ...report, saved: 20 }));
  assert.equal(readImportStatus(storage), undefined);
  values.set(IMPORT_STATUS_KEY, "not json");
  assert.equal(readImportStatus(storage), undefined);
  writeImportStatus(report, storage);
  clearImportStatus(storage);
  assert.equal(readImportStatus(storage), undefined);
});
test("blocked report storage cannot prevent file saving logic or throw on startup", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("full");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(readImportStatus(blocked), undefined);
  assert.doesNotThrow(() =>
    writeImportStatus(
      {
        version: 1,
        id: "run",
        planned: 1,
        saved: 0,
        phase: "reading",
        message: "reading",
      },
      blocked,
    ),
  );
  assert.doesNotThrow(() => clearImportStatus(blocked));
});
test("unavailable local reads time out; normal reads are unchanged and late results are not accepted", async () => {
  const bytes = await readFileBytes(new File(["hello"], "code.py"));
  assert.equal(new TextDecoder().decode(bytes), "hello");
  let finish;
  const file = {
    arrayBuffer: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  };
  await assert.rejects(readFileBytes(file, 5), /available offline/);
  finish(new ArrayBuffer(0));
});
