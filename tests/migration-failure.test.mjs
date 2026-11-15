import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { readLibrary, DATABASE } from "../src/storage.ts";

test("an invalid v1 record aborts migration and preserves the entire old database", async () => {
  const original = {
    version: 1,
    revision: 5,
    documents: [{ text: "PRIVATE_UNMIGRATED" }],
    categories: [],
    globalLocalOnly: true,
  };
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workspace");
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("workspace", "readwrite");
      transaction.objectStore("workspace").put(original, "current");
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onabort = reject;
    };
  });
  await assert.rejects(() => readLibrary(), /not be opened or migrated/);
  const preserved = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onsuccess = () => {
      assert.equal(request.result.version, 1);
      const database = request.result;
      const transaction = database.transaction("workspace");
      const read = transaction.objectStore("workspace").get("current");
      transaction.oncomplete = () => {
        database.close();
        resolve(read.result);
      };
    };
    request.onerror = reject;
  });
  assert.deepEqual(preserved, original);
});
