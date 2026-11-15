import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupFolders,
  collectionDescriptionPrompt,
  validateCollectionDescription,
} from "../src/folders-view.ts";
test("folder groups preserve imported hierarchy; local descriptions require sampled evidence", () => {
  const groups = groupFolders([
    { id: "a", contentHash: "a", relativePath: "Class/Week1/a.txt" },
    { id: "b", contentHash: "b", relativePath: "Class/Week1/b.txt" },
    { id: "c", contentHash: "c" },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].documents.length, 2);
  assert.equal(groups[1].name, "Individual files");
  assert.ok(
    collectionDescriptionPrompt("Manufacturing processes").includes(
      "untrusted",
    ),
  );
  const raw = JSON.stringify({
    description: "Manufacturing notes.",
    quote: "Manufacturing",
  });
  assert.equal(
    validateCollectionDescription(raw, "on_device", "Manufacturing processes"),
    "Manufacturing notes.",
  );
  assert.throws(() =>
    validateCollectionDescription(raw, "in_cloud", "Manufacturing processes"),
  );
  assert.throws(() =>
    validateCollectionDescription(raw, "on_device", "Other source"),
  );
  assert.throws(() => collectionDescriptionPrompt("x".repeat(1401)));
});
