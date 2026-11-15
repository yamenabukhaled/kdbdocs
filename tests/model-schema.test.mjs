import { test } from "node:test";
import assert from "node:assert/strict";
import { Schema } from "firebase/ai";
import { nativeSchema, constrainReview } from "../src/model-schema.ts";
test("native constraints contain own required fields, nested bounds and exact category IDs", () => {
  const schema = Schema.object({
    properties: {
      categoryId: Schema.string(),
      reason: Schema.string(),
      quote: Schema.string(),
      needsIntent: Schema.boolean(),
    },
  });
  assert.equal(Object.hasOwn(schema, "required"), false);
  const native = constrainReview(schema, ["a", "b"]);
  assert.equal(Object.getPrototypeOf(native), Object.prototype);
  assert.deepEqual(native.required, [
    "categoryId",
    "reason",
    "quote",
    "needsIntent",
  ]);
  assert.deepEqual(native.properties.categoryId.enum, ["", "a", "b"]);
  assert.equal(native.additionalProperties, false);
  assert.equal("optionalProperties" in native, false);
  const discovery = nativeSchema(
    Schema.object({
      properties: {
        categories: Schema.array({
          maxItems: 2,
          items: Schema.object({
            properties: { name: Schema.string({ maxLength: 60 }) },
          }),
        }),
      },
    }),
  );
  assert.equal(discovery.properties.categories.maxItems, 2);
  assert.deepEqual(discovery.properties.categories.items.required, ["name"]);
});
