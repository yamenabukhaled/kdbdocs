import { test } from "node:test";
import assert from "node:assert/strict";
import { ContentSearch, validateSearchTerms } from "../src/search.ts";

test("content search distinguishes phrases and all-term matches, invalidates changed/deleted text and rejects unbounded expansions", () => {
  const search = new ContentSearch();
  const document = { id: "a", name: "opaque.txt", contentHash: "one" };
  search.add(document, "Lithium cells lose capacity at low temperatures.");
  assert.ok(
    search.find(document, '"low temperatures"')?.snippet.includes("Lithium"),
  );
  assert.equal(search.find(document, '"temperatures low"'), null);
  assert.ok(search.find(document, "capacity lithium"));
  assert.equal(search.find(document, "capacity invoice"), null);
  assert.ok(
    search.find(document, "batteries in winter", [
      "lithium",
      "low temperatures",
    ]),
  );
  search.prune([{ ...document, contentHash: "two" }]);
  assert.equal(search.has(document), false);
  search.add(document, "invoice");
  search.prune([]);
  assert.equal(search.has(document), false);
  const bounded = new ContentSearch(50);
  bounded.add(document, "a".repeat(20));
  const second = { ...document, id: "b" };
  bounded.add(second, "b".repeat(20));
  assert.equal(bounded.has(document), false);
  assert.equal(bounded.has(second), true);
  assert.throws(() => validateSearchTerms('{"terms":["x"]}', "in_cloud"));
  assert.throws(() =>
    validateSearchTerms(
      JSON.stringify({ terms: Array(9).fill("x") }),
      "on_device",
    ),
  );
});
