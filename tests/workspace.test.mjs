import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  categoryName,
  emptyWorkspace,
  isLocalOnly,
  removeCategory,
} from "../src/workspace.ts";

test("local policy is restrictive across workspace, document and category", () => {
  const state = emptyWorkspace();
  const document = { id: "doc", localOnly: false, categoryId: "category" };
  state.categories = [{ id: "category", localOnly: false }];
  assert.equal(isLocalOnly(state, document), true);
  state.globalLocalOnly = false;
  assert.equal(isLocalOnly(state, document), false);
  document.localOnly = true;
  assert.equal(isLocalOnly(state, document), true);
  document.localOnly = false;
  state.categories[0].localOnly = true;
  assert.equal(isLocalOnly(state, document), true);
});
test("removing a private collection cannot make its documents cloud eligible", () => {
  const state = emptyWorkspace();
  state.globalLocalOnly = false;
  state.categories = [{ id: "category", localOnly: true }];
  state.documents = [{ id: "doc", localOnly: false, categoryId: "category" }];
  const result = removeCategory(state, "category");
  assert.equal(result.categories.length, 0);
  assert.equal(result.documents[0].categoryId, null);
  assert.equal(result.documents[0].localOnly, true);
  assert.equal(state.documents[0].categoryId, "category");
});
test("category names are trimmed and unique without case sensitivity", () => {
  const categories = [{ id: "a", name: "Research" }];
  assert.equal(categoryName("  Coursework  ", categories), "Coursework");
  assert.throws(() => categoryName(" research ", categories), /already exists/);
  assert.throws(() => categoryName(" ", categories), /between 1 and 60/);
  assert.throws(
    () => categoryName("x".repeat(61), categories),
    /between 1 and 60/,
  );
  assert.equal(categoryName("Research", categories, "a"), "Research");
});
