import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("diagnostic remains isolated from document data and cannot silently fall back", async () => {
  const source = await readFile(
    new URL("../src/firebase.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /route === ["']cloud["'] && !consent\(\)/);
  assert.match(source, /InferenceMode\.ONLY_ON_DEVICE/);
  assert.match(source, /InferenceMode\.ONLY_IN_CLOUD/);
  assert.doesNotMatch(source, /InferenceMode\.PREFER_/);
  assert.match(source, /generateContent\(diagnosticPrompt\)/);
  assert.doesNotMatch(
    source,
    /file\.text|localStorage|indexedDB|firebase\/analytics|firebase\/firestore|firebase\/storage/,
  );
});
