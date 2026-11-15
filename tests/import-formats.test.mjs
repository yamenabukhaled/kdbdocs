import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { readOfficeArchive, MAX_XML_PART } from "../src/office-archive.ts";
import { parseFile } from "../src/parser.ts";
import { fileKind, FILE_ACCEPT, matchesFileType } from "../src/file-types.ts";
import { validateWorkspace } from "../src/backup.ts";

const office = (extra = {}) =>
  zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8("<document>sample</document>"),
    ...extra,
  });
function entry(data, name) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i + 46 < data.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      const length = view.getUint16(i + 28, true);
      if (
        new TextDecoder().decode(data.subarray(i + 46, i + 46 + length)) ===
        name
      )
        return i;
    }
  }
  throw new Error("Fixture missing central entry");
}
test("Office archive extraction is selective and verifies sizes/checksums without trusting ZIP64 declarations", () => {
  const archive = office({
    "word/media/image1.png": new Uint8Array(2_000_000),
  });
  assert.deepEqual(
    readOfficeArchive(archive, "word").map((p) => p.name),
    ["[Content_Types].xml", "word/document.xml"],
  );
  const corrupt = archive.slice(),
    corruptView = new DataView(corrupt.buffer);
  corruptView.setUint32(entry(corrupt, "word/document.xml") + 16, 0, true);
  assert.throws(() => readOfficeArchive(corrupt, "word"), /checksum/);
  const oversized = archive.slice();
  new DataView(oversized.buffer).setUint32(
    entry(oversized, "word/document.xml") + 24,
    MAX_XML_PART + 1,
    true,
  );
  assert.throws(() => readOfficeArchive(oversized, "word"), /safety limit/);
  const deceptive = office({
    "word/document.xml": strToU8("x".repeat(1_000_000)),
  });
  new DataView(deceptive.buffer).setUint32(
    entry(deceptive, "word/document.xml") + 24,
    1,
    true,
  );
  assert.throws(() => readOfficeArchive(deceptive, "word"), /declared size/);
  const zip64 = archive.slice();
  new DataView(zip64.buffer).setUint16(zip64.length - 22 + 10, 65535, true);
  assert.throws(() => readOfficeArchive(zip64, "word"), /ZIP64/);
  assert.throws(
    () => readOfficeArchive(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), "word"),
    /Password-protected/,
  );
  assert.throws(() => readOfficeArchive(strToU8("broken"), "word"), /Damaged/);
  assert.throws(
    () =>
      readOfficeArchive(
        office({
          "word/document.xml": strToU8(
            '<!DOCTYPE document [<!ENTITY x SYSTEM "https://example.invalid/private">]><document/>',
          ),
        }),
        "word",
      ),
    /entity declarations/,
  );
});
test("source allowlist, text decoding and binary refusal never execute imported code", async () => {
  for (const name of [
    "class.R",
    "reading.Rmd",
    "demo.py",
    "test.PYW",
    "site.js",
    "view.jsx",
    "task.mjs",
    "types.ts",
    "Main.java",
    "query.sql",
    "script.ps1",
    "page.html",
    "main.cpp",
  ]) {
    assert.equal(fileKind(name), "code");
    const result = await parseFile(
      new File(
        ["globalThis.__IMPORTED_CODE_RAN = true;\n<script>alert(1)</script>"],
        name,
      ),
      () => {},
    );
    assert.equal(result.status, "ready");
    assert.match(result.coverage.note, /never executed/);
    assert.match(result.text, /<script>/);
  }
  assert.equal(globalThis.__IMPORTED_CODE_RAN, undefined);
  const utf16 = await parseFile(
    new File([new Uint8Array([255, 254, 35, 0, 32, 0, 82, 0])], "windows.R"),
    () => {},
  );
  assert.equal(utf16.text, "# R");
  assert.match(utf16.coverage.note, /UTF-16LE/);
  const binary = await parseFile(
    new File([new Uint8Array([0, 1, 2, 3, 4])], "fake.py"),
    () => {},
  );
  assert.equal(binary.status, "error");
  assert.equal(binary.text, "");
  assert.match(binary.coverage.note, /binary data/);
  const unsupported = await parseFile(
    new File(["font bytes"], "font.ttf"),
    () => {},
  );
  assert.equal(unsupported.text, "");
  assert.match(unsupported.coverage.note, /Unsupported file type/);
  assert.ok(
    FILE_ACCEPT.includes(".docx") &&
      FILE_ACCEPT.includes(".pptx") &&
      FILE_ACCEPT.includes(".r"),
  );
  assert.ok(
    matchesFileType("notes.R", "code") &&
      matchesFileType("view.jsx", "javascript"),
  );
  assert.equal(matchesFileType("book.pdf", "code"), false);
});
test("slide provenance survives portable backup validation", () => {
  const workspace = validateWorkspace({
    version: 1,
    revision: 0,
    globalLocalOnly: true,
    categories: [],
    documents: [
      {
        id: "d",
        name: "deck.pptx",
        size: 100,
        importedAt: "2026-11-13",
        text: "[Slide 1]\nhello",
        status: "ready",
        categoryId: null,
        localOnly: true,
        chunks: [{ start: 0, end: 15, slide: 1 }],
        coverage: {
          truncated: false,
          note: "One slide",
          slidesRead: 1,
          totalSlides: 1,
          emptySlides: 0,
        },
      },
    ],
  });
  assert.equal(workspace.documents[0].chunks[0].slide, 1);
  assert.equal(workspace.documents[0].coverage.totalSlides, 1);
});
