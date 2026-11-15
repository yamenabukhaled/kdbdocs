import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scanFolderEntries,
  scanPickedFolder,
  planFolder,
  folderBatches,
  resolveDroppedEntries,
} from "../src/folder-import.ts";
import { relativePath } from "../src/paths.ts";
import { validateWorkspace } from "../src/backup.ts";
import { ContentSearch } from "../src/search.ts";

const file = (name, text = "hello") => new File([text], name);
const leaf = (name) => ({
  name,
  isFile: true,
  isDirectory: false,
  file: (success) => success(file(name)),
});
test("modern folder handles enumerate through the bounded reader and fall back to legacy handles", async () => {
  const signal = new AbortController().signal;
  const handle = {
    name: "modern",
    kind: "directory",
    async *values() {
      yield {
        name: "code.py",
        kind: "file",
        getFile: async () => file("code.py"),
      };
    },
  };
  const entries = await resolveDroppedEntries(
    [null],
    [Promise.resolve(handle)],
    signal,
  );
  const result = await scanFolderEntries(entries, signal, () => {});
  assert.equal(result.files[0].relativePath, "modern/code.py");
  const legacy = leaf("fallback.txt");
  assert.equal(
    (await resolveDroppedEntries([legacy], [Promise.resolve(null)], signal))[0],
    legacy,
  );
});
function directory(name, children) {
  return {
    name,
    isDirectory: true,
    isFile: false,
    createReader() {
      let offset = 0;
      return {
        readEntries(success) {
          const batch = children.slice(offset, offset + 100);
          offset += 100;
          success(batch);
        },
      };
    },
  };
}
test("folder traversal consumes every directory page, preserves duplicate basenames and skips dependency trees", async () => {
  const roots = [
    directory("root", [
      directory(
        "class",
        Array.from({ length: 105 }, (_, i) => leaf(`${i}.py`)),
      ),
      directory("research", [leaf("0.py")]),
      directory("node_modules", [leaf("do-not-read.js")]),
    ]),
  ];
  const scan = await scanFolderEntries(
    roots,
    new AbortController().signal,
    () => {},
  );
  assert.equal(scan.files.length, 106);
  assert.equal(scan.ignored, 1);
  assert.ok(scan.files.some((f) => f.relativePath === "root/class/104.py"));
  assert.ok(scan.files.some((f) => f.relativePath === "root/research/0.py"));
  assert.equal(scan.issues.length, 0);
  const plan = planFolder(scan, [
    { name: "0.py", size: 5, relativePath: "root/class/0.py" },
  ]);
  assert.equal(
    plan.find((f) => f.relativePath === "root/class/0.py").existing,
    true,
  );
  assert.equal(
    plan.find((f) => f.relativePath === "root/research/0.py").blocked,
    undefined,
  );
});
test("scan cancellation, unreadable entries and depth/file bounds never imply a complete scan", async () => {
  const broken = {
    name: "gone.txt",
    isFile: true,
    isDirectory: false,
    file: (_, error) => error(new Error("Unavailable")),
  };
  const scan = await scanFolderEntries(
    [directory("root", [broken, leaf("ok.txt")])],
    new AbortController().signal,
    () => {},
  );
  assert.equal(scan.files.length, 1);
  assert.equal(
    planFolder(scan, []).find((item) => item.relativePath.endsWith("gone.txt"))
      .unreadable,
    true,
  );
  assert.match(scan.issues[0], /gone.txt/);
  const abort = new AbortController();
  const pending = scanFolderEntries(
    [
      {
        name: "waiting",
        isDirectory: true,
        isFile: false,
        createReader: () => ({ readEntries() {} }),
      },
    ],
    abort.signal,
    () => {},
  );
  abort.abort();
  await assert.rejects(pending, /abort/i);
  const limited = await scanFolderEntries(
    [
      directory(
        "root",
        Array.from({ length: 1005 }, (_, i) => leaf(`${i}.txt`)),
      ),
    ],
    new AbortController().signal,
    () => {},
  );
  assert.equal(limited.files.length, 1000);
  assert.equal(limited.limited, true);
  assert.ok(limited.issues.length);
});
test("preview plans block unsupported/oversized/duplicate paths, and import batches respect file and byte limits", () => {
  const files = [file("one.py"), file("font.ttf"), file("large.pdf")];
  Object.defineProperty(files[2], "size", { value: 20_000_001 });
  files.forEach((f) =>
    Object.defineProperty(f, "webkitRelativePath", { value: `root/${f.name}` }),
  );
  const picked = scanPickedFolder([...files, files[0]]);
  const plan = planFolder(picked, []);
  assert.equal(plan[0].blocked, "Unsupported file type");
  assert.ok(plan.some((f) => f.blocked?.includes("size limit")));
  assert.ok(plan.some((f) => f.blocked?.includes("Duplicate relative")));
  const batches = folderBatches(
    Array.from({ length: 65 }, () => ({ size: 2_000_000 })),
  );
  assert.deepEqual(
    batches.map((b) => b.length),
    [25, 25, 15],
  );
  assert.deepEqual(
    folderBatches(Array.from({ length: 31 }, () => ({ size: 1 }))).map(
      (b) => b.length,
    ),
    [30, 1],
  );
});
test("relative paths are local searchable metadata and survive backup validation without accepting absolute/traversal paths", () => {
  for (const value of [
    "../secret.txt",
    "/etc/a",
    "C:\\Users\\a.txt",
    "root//a.txt",
    "root/./a.txt",
    "x/".repeat(33) + "a",
  ])
    assert.throws(() => relativePath(value));
  const doc = {
    id: "d",
    name: "notes.txt",
    relativePath: "root/research/notes.txt",
    size: 5,
    text: "hello",
    importedAt: "2026-11-14",
    categoryId: null,
    localOnly: true,
    status: "ready",
    coverage: { truncated: false, note: "all" },
  };
  const saved = validateWorkspace({
    version: 1,
    revision: 0,
    globalLocalOnly: true,
    categories: [],
    documents: [doc],
  });
  assert.equal(saved.documents[0].relativePath, doc.relativePath);
  const index = new ContentSearch();
  const meta = { ...doc, contentHash: "hash" };
  index.add(meta, doc.text);
  assert.ok(index.find(meta, "research"));
  assert.throws(() =>
    validateWorkspace({
      ...saved,
      documents: [{ ...doc, relativePath: "/private" }],
    }),
  );
});
