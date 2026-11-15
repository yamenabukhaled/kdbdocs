import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLibrary } from "../src/storage.ts";
import {
  screenText,
  validateSummary,
  preparePlan,
  planPrompt,
  validatePlan,
  validateLocalPlace,
  applyPlan,
  defaultChoices,
  PLAN_VERSION,
  clip,
  answerQuestion,
  pendingFromPlan,
} from "../src/plan.ts";

test("clip ends at a sentence or word, never mid-word", () => {
  assert.equal(clip("Short.", 240), "Short.");
  assert.equal(
    clip("First sentence is here. Second sentence goes on and on", 40),
    "First sentence is here.",
  );
  assert.equal(clip("one two three four five", 12), "one two…");
});

const BODY_MARKER = "UNIQUE-BODY-TEXT-7781";
const summary = (
  hash,
  text = "Lecture notes for a statistics course.",
  extra = {},
) => ({
  text,
  topics: ["statistics"],
  contentHash: hash,
  sensitive: false,
  reasons: [],
  version: PLAN_VERSION,
  ...extra,
});
const doc = (id, extra = {}) => ({
  id,
  name: `${id}.pdf`,
  size: 10,
  importedAt: "2026-11-15",
  categoryId: null,
  localOnly: false,
  characters: 100,
  contentHash: `h-${id}`,
  preview: BODY_MARKER,
  status: "ready",
  coverage: { truncated: false, note: "full" },
  summary: summary(`h-${id}`),
  ...extra,
});
const library = (documents, extra = {}) => ({
  ...emptyLibrary(),
  globalLocalOnly: false,
  documents,
  ...extra,
});

test("screenText finds personal-data types without returning the data", () => {
  const hits = screenText(
    "Contact jane.doe@example.com or +971 50 123 4567. Card 4111 1111 1111 1111.",
  );
  assert.deepEqual(hits.sort(), [
    "card number",
    "email address",
    "phone number",
  ]);
  assert.ok(!hits.join(" ").includes("jane"));
  assert.ok(
    screenText("Account: GB82 WEST 1234 5698 7654 32").includes(
      "bank account (IBAN)",
    ),
  );
  assert.ok(screenText("Your password is hunter2").includes("credentials"));
});

test("screenText leaves ordinary coursework alone", () => {
  assert.deepEqual(
    screenText(
      "Week 3: regression. Table 2 lists 1999 2000 2001 values. See section 4.2.",
      "stats-notes.pdf",
      "Uni/Year 2",
    ),
    [],
  );
  // A long number that fails the Luhn check is not a card.
  assert.deepEqual(screenText("Order 1234567890123"), []);
});

test("validateSummary rejects cloud sources and treats a missing flag as sensitive", () => {
  assert.throws(() =>
    validateSummary('{"summary":"x","sensitive":false}', "in_cloud", "h", []),
  );
  assert.throws(() => validateSummary("not json", "on_device", "h", []));
  assert.throws(() => validateSummary('{"summary":""}', "on_device", "h", []));
  const unknown = validateSummary(
    '{"summary":"A recipe."}',
    "on_device",
    "h",
    [],
  );
  assert.equal(unknown.sensitive, true);
  const clean = validateSummary(
    JSON.stringify({
      summary: "A recipe.",
      topics: ["food", 3, "", "baking"],
      sensitive: false,
      sensitiveReason: "",
    }),
    "on_device",
    "h",
    [],
  );
  assert.equal(clean.sensitive, false);
  assert.deepEqual(clean.topics, ["food", "baking"]);
  const screened = validateSummary(
    '{"summary":"A CV.","sensitive":false}',
    "on_device",
    "h",
    ["email address"],
  );
  assert.equal(screened.sensitive, true);
  assert.deepEqual(screened.reasons, ["email address"]);
});

test("preparePlan sends summaries only and keeps protected files local", () => {
  const lib = library(
    [
      doc("a", { relativePath: "Uni/Stats/a.pdf" }),
      doc("b", { localOnly: true }),
      doc("c", {
        summary: summary("h-c", "A CV.", {
          sensitive: true,
          reasons: ["email address"],
        }),
      }),
      doc("d", { summary: undefined }),
      doc("e", { summary: summary("h-e", "Notes; contact me at x@y.com") }),
      doc("f", { categoryId: "already" }),
      doc("g", { summary: summary("stale-hash") }),
    ],
    {
      categories: [
        {
          id: "k1",
          name: "Coursework",
          description: "Classes",
          examples: "",
          localOnly: false,
        },
        {
          id: "k2",
          name: "Private",
          description: "secret stuff",
          examples: "",
          localOnly: true,
        },
        {
          id: "k3",
          name: "Legacy",
          description: "",
          examples: "",
          localOnly: false,
          proposalSource: "x",
        },
      ],
    },
  );
  const prepared = preparePlan(lib, ["a", "b", "c", "d", "e", "f", "g"]);
  assert.deepEqual([...prepared.refs.values()], ["a"]);
  const sent = JSON.stringify(prepared.payload);
  assert.ok(!sent.includes(BODY_MARKER), "body text must never be sent");
  assert.ok(
    !sent.includes("secret stuff"),
    "local-only collection must not be sent",
  );
  assert.ok(!sent.includes("Legacy"));
  assert.deepEqual(
    prepared.payload.collections.map((c) => c.name),
    ["Coursework"],
  );
  assert.equal(prepared.payload.files[0].folder, "Uni/Stats");
  const reasons = Object.fromEntries(
    prepared.kept.map((k) => [k.id, k.reason]),
  );
  assert.deepEqual(reasons, {
    b: "local-only setting",
    c: "sensitive",
    d: "no summary",
    e: "sensitive",
    g: "no summary",
  });
  assert.ok(!planPrompt(prepared.payload).includes(BODY_MARKER));
});

test("preparePlan sends nothing while the workspace is local-only", () => {
  const prepared = preparePlan(library([doc("a")], { globalLocalOnly: true }), [
    "a",
  ]);
  assert.equal(prepared.payload.files.length, 0);
  assert.equal(prepared.kept[0].reason, "workspace local-only");
});

test("validatePlan drops bad items instead of failing the batch", () => {
  const lib = library(
    [doc("a"), doc("b"), doc("c", { rejectedCategoryIds: ["k1"] })],
    {
      categories: [
        {
          id: "k1",
          name: "Coursework",
          description: "",
          examples: "",
          localOnly: false,
        },
      ],
    },
  );
  const prepared = preparePlan(lib, ["a", "b", "c"]);
  const raw = JSON.stringify({
    newCollections: [
      { key: "n1", name: "Research", description: "Independent reading" },
      { key: "n2", name: "coursework", description: "dup of existing" },
      { key: "bad key", name: "X" },
      { key: "n3", name: "" },
      { key: "n4", name: "Unused" },
    ],
    placements: [
      { file: "f1", collection: "c1", confidence: "high" },
      { file: "f2", collection: "n9", confidence: "high" },
      { file: "f3", collection: "c1", confidence: "high" },
      { file: "f99", collection: "n1", confidence: "high" },
    ],
    questions: [
      {
        question: "Class or your own research?",
        files: ["f1", "f99"],
        options: [
          { label: "Class", collection: "c1" },
          { label: "Own research", collection: "n1" },
          { label: "Also class", collection: "c1" },
        ],
      },
      {
        question: "Only one option",
        files: ["f2"],
        options: [{ label: "x", collection: "c1" }],
      },
    ],
  });
  const plan = validatePlan(raw, prepared, lib);
  assert.deepEqual(
    plan.collections.map((c) => c.name),
    ["Coursework", "Research"],
  );
  const by = Object.fromEntries(plan.placements.map((p) => [p.documentId, p]));
  assert.equal(by.a.collectionKey, "c:k1");
  assert.equal(by.a.confidence, "high");
  assert.equal(by.b.collectionKey, null, "unknown key becomes unfiled");
  assert.equal(by.b.confidence, "low");
  assert.equal(
    by.c.collectionKey,
    null,
    "rejected collection is not suggested again",
  );
  assert.equal(plan.questions.length, 1);
  assert.deepEqual(plan.questions[0].documentIds, ["a"]);
  assert.equal(plan.questions[0].options.length, 2);
  assert.throws(() => validatePlan("{oops", prepared, lib));
});

test("validateLocalPlace only accepts listed ids from the device", () => {
  assert.throws(() =>
    validateLocalPlace('{"categoryId":"k1"}', "in_cloud", ["k1"]),
  );
  assert.deepEqual(
    validateLocalPlace('{"categoryId":"zz","confidence":"high"}', "on_device", [
      "k1",
    ]),
    {
      collectionKey: null,
      confidence: "low",
    },
  );
  assert.deepEqual(
    validateLocalPlace('{"categoryId":"k1","confidence":"high"}', "on_device", [
      "k1",
    ]),
    {
      collectionKey: "k1",
      confidence: "high",
    },
  );
});

test("applyPlan creates used collections, assigns, records rejections and leaves the old library intact", () => {
  const lib = library([doc("a"), doc("b"), doc("c")], {
    categories: [
      {
        id: "k1",
        name: "Coursework",
        description: "",
        examples: "",
        localOnly: false,
      },
    ],
    events: [
      {
        id: "e0",
        documentId: "a",
        action: "skip",
        categoryId: null,
        previousCategoryId: null,
        createdAt: "",
        active: true,
        localOnly: false,
        categoryVersion: "",
        quote: "",
      },
    ],
  });
  const plan = {
    id: "p",
    createdAt: "",
    collections: [
      { key: "c:k1", name: "Coursework", description: "", existingId: "k1" },
      { key: "new:n1", name: "Research", description: "Reading" },
      { key: "new:n2", name: "Never used", description: "" },
    ],
    placements: [
      {
        documentId: "a",
        collectionKey: "c:k1",
        confidence: "high",
        route: "cloud",
      },
      {
        documentId: "b",
        collectionKey: "new:n1",
        confidence: "low",
        route: "cloud",
      },
      {
        documentId: "c",
        collectionKey: "c:k1",
        confidence: "high",
        route: "cloud",
      },
    ],
    questions: [],
  };
  const choices = defaultChoices(plan);
  choices.set("c", null); // user rejects
  const before = JSON.stringify(lib);
  const result = applyPlan(
    lib,
    plan,
    choices,
    new Map([["new:n1", "Own research"]]),
  );
  assert.equal(
    JSON.stringify(lib),
    before,
    "previous library is the Undo snapshot",
  );
  assert.deepEqual(result.created, ["Own research"]);
  assert.equal(result.assigned, 2);
  assert.equal(result.unfiled, 1);
  const names = result.library.categories.map((c) => c.name);
  assert.deepEqual(names, ["Coursework", "Own research"]);
  const by = Object.fromEntries(result.library.documents.map((d) => [d.id, d]));
  assert.equal(by.a.categoryId, "k1");
  assert.equal(by.b.categoryId, result.library.categories[1].id);
  assert.equal(by.c.categoryId, null);
  assert.deepEqual(by.c.rejectedCategoryIds, ["k1"]);
  assert.equal(result.library.events.find((e) => e.id === "e0").active, false);
  const actions = result.library.events
    .filter((e) => e.id !== "e0")
    .map((e) => e.action);
  assert.deepEqual(actions, ["confirm", "confirm"]);
});

test("applyPlan refuses when a file was filed meanwhile", () => {
  const lib = library([doc("a", { categoryId: "k1" })], {
    categories: [
      {
        id: "k1",
        name: "Coursework",
        description: "",
        examples: "",
        localOnly: false,
      },
    ],
  });
  const plan = {
    id: "p",
    createdAt: "",
    questions: [],
    collections: [
      { key: "c:k1", name: "Coursework", description: "", existingId: "k1" },
    ],
    placements: [
      {
        documentId: "a",
        collectionKey: "c:k1",
        confidence: "high",
        route: "cloud",
      },
    ],
  };
  assert.throws(() => applyPlan(lib, plan, defaultChoices(plan)));
});

test("automatic filing records no review events; answers do, and become preferences", () => {
  const lib = library([doc("a"), doc("b")], {
    categories: [
      {
        id: "k1",
        name: "Coursework",
        description: "",
        examples: "",
        localOnly: false,
      },
      {
        id: "k2",
        name: "Research",
        description: "",
        examples: "",
        localOnly: false,
      },
    ],
  });
  const plan = {
    id: "p",
    createdAt: "",
    collections: [
      { key: "c:k1", name: "Coursework", description: "", existingId: "k1" },
      { key: "c:k2", name: "Research", description: "", existingId: "k2" },
    ],
    placements: [
      {
        documentId: "a",
        collectionKey: "c:k1",
        confidence: "high",
        route: "cloud",
      },
      {
        documentId: "b",
        collectionKey: "c:k2",
        confidence: "low",
        route: "cloud",
      },
    ],
    questions: [
      {
        question: "Class or own research?",
        documentIds: ["b"],
        options: [
          {
            label: "Class",
            collectionKey: "c:k1",
            preference: "Survey papers go in Coursework",
          },
          {
            label: "Own research",
            collectionKey: "c:k2",
            preference: "Survey papers go in Research",
          },
        ],
      },
    ],
  };
  const applied = applyPlan(lib, plan, defaultChoices(plan), new Map(), true);
  assert.equal(
    applied.library.events.length,
    0,
    "a guess is not a confirmed example",
  );
  const pending = pendingFromPlan(plan, applied.idForKey);
  assert.equal(pending[0].options[0].collectionId, "k1");
  const withQ = { ...applied.library, pendingQuestions: pending };
  const answered = answerQuestion(withQ, pending[0].id, 0);
  assert.equal(answered.moved, 1);
  const b = answered.library.documents.find((d) => d.id === "b");
  assert.equal(b.categoryId, "k1");
  assert.equal(answered.library.events.length, 1);
  assert.deepEqual(
    answered.library.preferences.map((p) => p.text),
    ["Survey papers go in Coursework"],
  );
  assert.equal(answered.library.pendingQuestions.length, 0);
  // Skipping drops the question without moving or learning.
  const skipped = answerQuestion(withQ, pending[0].id, null);
  assert.equal(skipped.moved, 0);
  assert.equal(skipped.library.preferences, undefined);
  // Learned preferences are sent with the next plan, mapped to collection keys.
  const next = preparePlan(
    {
      ...answered.library,
      documents: [...answered.library.documents, doc("c")],
    },
    ["c"],
  );
  assert.deepEqual(next.payload.preferences, [
    { rule: "Survey papers go in Coursework", collection: "c1" },
  ]);
  assert.ok(
    planPrompt(next.payload).includes("Survey papers go in Coursework"),
  );
});

test("an answer can create a proposed collection that no file was filed into yet", () => {
  const lib = library([doc("a")], {
    categories: [
      {
        id: "k1",
        name: "Coursework",
        description: "",
        examples: "",
        localOnly: false,
      },
    ],
  });
  const plan = {
    id: "p",
    createdAt: "",
    collections: [
      { key: "c:k1", name: "Coursework", description: "", existingId: "k1" },
      { key: "new:n1", name: "Research", description: "Own reading" },
    ],
    placements: [
      {
        documentId: "a",
        collectionKey: "c:k1",
        confidence: "low",
        route: "cloud",
      },
    ],
    questions: [
      {
        question: "Coursework or research?",
        documentIds: ["a"],
        options: [
          { label: "Coursework", collectionKey: "c:k1" },
          {
            label: "Research",
            collectionKey: "new:n1",
            preference: "Surveys are Research",
          },
        ],
      },
    ],
  };
  const applied = applyPlan(lib, plan, defaultChoices(plan), new Map(), true);
  assert.deepEqual(
    applied.created,
    [],
    "Research had no files, so it isn't created yet",
  );
  const pending = pendingFromPlan(plan, applied.idForKey);
  assert.equal(pending[0].options[1].collectionId, null);
  assert.deepEqual(pending[0].options[1].newCollection, {
    name: "Research",
    description: "Own reading",
  });
  const answered = answerQuestion(
    { ...applied.library, pendingQuestions: pending },
    pending[0].id,
    1,
  );
  const research = answered.library.categories.find(
    (c) => c.name === "Research",
  );
  assert.ok(research, "choosing it creates the collection");
  assert.equal(answered.library.documents[0].categoryId, research.id);
  assert.equal(answered.library.preferences[0].collectionId, research.id);
});

test("dated items: only real dates in a sensible window, at most three", async () => {
  const { validDates } = await import("../src/plan.ts");
  const today = new Date(2026, 10, 16); // 16 Nov 2026
  assert.deepEqual(
    validDates(
      [
        { what: "Electricity bill due", date: "2026-11-20" },
        { what: "Impossible", date: "2026-02-31" },
        { what: "Wrong format", date: "20 Nov 2026" },
        { what: "", date: "2026-12-01" },
        { what: "Too far back", date: "2020-01-01" },
        { what: "Too far ahead", date: "2035-01-01" },
        { what: "Winter flight", date: "2026-12-20" },
        { what: "Exam", date: "2027-01-10" },
        { what: "Fourth", date: "2027-02-01" },
      ],
      today,
    ),
    [
      { what: "Electricity bill due", date: "2026-11-20" },
      { what: "Winter flight", date: "2026-12-20" },
      { what: "Exam", date: "2027-01-10" },
    ],
  );
  assert.deepEqual(validDates("nope", today), []);
});

test("coming up: upcoming only, soonest first, dismissed items hidden", async () => {
  const { comingUp } = await import("../src/plan.ts");
  const today = new Date(2026, 10, 16);
  const lib = library(
    [
      doc("a", {
        summary: summary("h-a", "An invoice.", {
          dates: [
            { what: "Bill due", date: "2026-11-20" },
            { what: "Old", date: "2026-11-01" },
          ],
        }),
      }),
      doc("b", {
        summary: summary("h-b", "A trip.", {
          dates: [{ what: "Flight", date: "2026-12-20" }],
        }),
      }),
      doc("c", {
        summary: summary("h-c", "Brief.", {
          dates: [{ what: "Due today", date: "2026-11-16" }],
        }),
      }),
    ],
    { dismissedDates: ["b|2026-12-20|Flight"] },
  );
  assert.deepEqual(
    comingUp(lib, today).map((i) => i.what),
    ["Due today", "Bill due"],
  );
});
