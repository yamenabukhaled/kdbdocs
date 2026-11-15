import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBackup, parseBackup, restorePlan } from "../src/backup.ts";
const state = () => ({
  version: 1,
  revision: 0,
  globalLocalOnly: false,
  categories: [
    {
      id: "c",
      name: "Research",
      description: "",
      examples: "",
      localOnly: false,
    },
  ],
  documents: [
    {
      id: "d",
      name: "paper.txt",
      size: 4,
      importedAt: "2026-11-12",
      text: "text",
      status: "ready",
      coverage: { note: "Full text", truncated: false },
      categoryId: "c",
      localOnly: false,
    },
  ],
});
test("portable backup round trips and rejects malformed schemas/versions/references", () => {
  assert.deepEqual(parseBackup(makeBackup(state())), state());
  for (const text of [
    "bad",
    "{}",
    '{"format":"document-assistant-backup","version":99}',
    JSON.stringify({
      format: "document-assistant-backup",
      version: 1,
      workspace: { ...state(), categories: [] },
    }),
  ])
    assert.throws(() => parseBackup(text), /backup/);
  assert.throws(
    () => makeBackup({ ...state(), globalLocalOnly: "false" }),
    /backup/,
  );
});
test("restore previews preserve existing conflicts and strengthen imported protection", () => {
  const existing = state();
  const incoming = state();
  incoming.documents[0].text = "must not overwrite";
  const merged = restorePlan(existing, incoming, "merge");
  assert.equal(merged.documents.length, 1);
  assert.equal(merged.documents[0].text, "text");
  const replaced = restorePlan(existing, incoming, "replace");
  assert.equal(replaced.globalLocalOnly, true);
  assert.equal(replaced.documents[0].localOnly, true);
  assert.equal(replaced.categories[0].localOnly, true);
  assert.equal(existing.documents[0].localOnly, false);
});
