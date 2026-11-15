import { test } from "node:test";
import assert from "node:assert/strict";
import { excerptRanges } from "../src/analysis.ts";

test("sampled character coverage never double-counts overlapping excerpts", () => {
  for (const length of [8001, 8500, 9000, 10000, 500000]) {
    const ranges = excerptRanges({
      text: "x".repeat(length),
      chunks: [],
      id: "x",
      parserVersion: "test",
    });
    assert.equal(
      ranges.reduce((sum, range) => sum + range.end - range.start, 0),
      8000,
    );
    for (let index = 1; index < ranges.length; index++)
      assert.ok(ranges[index].start >= ranges[index - 1].end);
  }
});
