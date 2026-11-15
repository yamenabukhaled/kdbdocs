import { test, expect } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const zip = (parts: Record<string, string>) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries({
          "[Content_Types].xml":
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
          ...parts,
        }).map(([name, text]) => [name, strToU8(text)]),
      ),
    ),
  );
const word = (body: string, extras: Record<string, string> = {}) =>
  zip({
    "word/document.xml": `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    ...extras,
  });
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
function presentation(count = 2) {
  const parts: Record<string, string> = {
    "ppt/presentation.xml": `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst>${Array.from({ length: count }, (_, i) => `<p:sldId id="${256 + i}" r:id="r${i + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships xmlns="${REL}">${Array.from({ length: count }, (_, i) => `<Relationship Id="r${i + 1}" Type="${R}/slide" Target="slides/slide${count - i}.xml"/>`).join("")}</Relationships>`,
  };
  for (let number = 1; number <= count; number++)
    parts[`ppt/slides/slide${number}.xml`] =
      `<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Manufacturing slide ${number} machining</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  parts[`ppt/slides/_rels/slide${count}.xml.rels`] =
    `<Relationships xmlns="${REL}"><Relationship Id="notes" Type="${R}/notesSlide" Target="../notesSlides/notesSlide7.xml"/><Relationship Id="external" Type="${R}/image" Target="https://example.invalid/PRIVATE_RESOURCE" TargetMode="External"/></Relationships>`;
  parts["ppt/notesSlides/notesSlide7.xml"] =
    `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Speaker reminder: tolerances and surface finish</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>IGNORED_PAGE_NUMBER</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
  return zip(parts);
}

test("Word, ordered PowerPoint/notes and source code persist and search locally without executing content or fetching relationships", async ({
  page,
}) => {
  const outbound: string[] = [];
  await page.route("**/*", (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:5190/")) {
      outbound.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await page.locator("#open-upload").click();
  await page.locator("#auto-organize").uncheck();
  await page.locator("#close-upload").click();
  await page.locator("#all-filter").click();
  const source =
    "globalThis.IMPORTED_CODE_EXECUTED = true;\n# probability regression café";
  const sourceFiles = [
    "class.R",
    "analyse.py",
    "app.js",
    "Main.java",
    "ui.tsx",
    "script.ps1",
    "page.html",
  ].map((name) => ({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(
      source + "<script>window.IMPORTED_CODE_EXECUTED=true</script>",
    ),
  }));
  await page.locator("#library-files").setInputFiles([
    {
      name: "assignment.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: word(
        paragraph("Assignment &amp; analysis café") +
          `<w:tbl><w:tr><w:tc>${paragraph("Probability table entry")}</w:tc></w:tr></w:tbl><w:del>${paragraph("DELETED_WORD_TEXT")}</w:del>`,
        {
          "word/footnotes.xml": `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${paragraph("Footnote about posterior odds")}</w:footnote></w:footnotes>`,
        },
      ),
    },
    {
      name: "lecture.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: presentation(),
    },
    ...sourceFiles,
  ]);
  await expect(page.locator("#workspace-message")).toContainText(
    "9 documents saved locally",
  );
  await expect(page.locator("#document-detail pre")).toContainText(
    "Assignment & analysis café",
  );
  await expect(page.locator("#document-detail pre")).toContainText(
    "Probability table entry",
  );
  await expect(page.locator("#document-detail pre")).toContainText(
    "Footnote about posterior odds",
  );
  await expect(page.locator("#document-detail pre")).not.toContainText(
    "DELETED_WORD_TEXT",
  );
  await page
    .getByRole("button", { name: "Open lecture.pptx", exact: true })
    .click();
  await expect(page.locator("#document-detail")).toContainText(
    "2 of 2 slides read",
  );
  await expect(page.locator("#document-detail pre")).toContainText(
    "Speaker reminder",
  );
  await expect(page.locator("#document-detail pre")).not.toContainText(
    "IGNORED_PAGE_NUMBER",
  );
  const text = await page.locator("#document-detail pre").textContent();
  expect(text!.indexOf("slide 2")).toBeLessThan(text!.indexOf("slide 1"));
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#document-search").fill("surface finish");
  await expect(page.locator(".document-row")).toHaveCount(1);
  await expect(page.locator(".document-row")).toContainText("lecture.pptx");
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#document-search").fill("");
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#browse-filters").evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  await page.locator("#type-filter").selectOption("code");
  await expect(page.locator(".document-row")).toHaveCount(7);
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#browse-filters").evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  await page.locator("#type-filter").selectOption("python");
  await expect(page.locator(".document-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Open analyse.py", exact: true })
    .click();
  await expect(page.locator("#document-detail")).toContainText(
    "never executed or compiled",
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { IMPORTED_CODE_EXECUTED?: boolean })
          .IMPORTED_CODE_EXECUTED,
    ),
  ).toBeUndefined();
  await page.reload();
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#document-search").fill("posterior odds");
  await expect(page.locator(".document-row")).toHaveCount(1);
  await expect(page.locator(".document-row")).toContainText("assignment.docx");
  expect(outbound).toEqual([]);
});

test("Office limits, damaged/encrypted packages, legacy formats and binary source files remain explicit manual cases", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await page.locator("#open-upload").click();
  await page.locator("#auto-organize").uncheck();
  await page.locator("#close-upload").click();
  await page.locator("#all-filter").click();
  await page.locator("#library-files").setInputFiles([
    {
      name: "large.docx",
      mimeType: "application/octet-stream",
      buffer: word(paragraph("A".repeat(500100))),
    },
    {
      name: "many.pptx",
      mimeType: "application/octet-stream",
      buffer: presentation(151),
    },
    {
      name: "encrypted.docx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    },
    {
      name: "broken.pptx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("not an Office package"),
    },
    {
      name: "old.doc",
      mimeType: "application/msword",
      buffer: Buffer.from("old"),
    },
    { name: "font.ttf", mimeType: "font/ttf", buffer: Buffer.from("font") },
    {
      name: "binary.py",
      mimeType: "text/plain",
      buffer: Buffer.from([0, 0, 1, 2]),
    },
  ]);
  await expect(page.locator("#workspace-message")).toContainText(
    "7 documents saved locally",
  );
  await expect(page.locator("#document-detail")).toContainText(
    "Extraction capped at 500,000",
  );
  await page
    .getByRole("button", { name: "Open many.pptx", exact: true })
    .click();
  await expect(page.locator("#document-detail")).toContainText(
    "150 of 151 slides read",
  );
  await page
    .getByRole("button", { name: "Open encrypted.docx", exact: true })
    .click();
  await expect(page.locator("#document-detail")).toContainText(
    "Password-protected or legacy Office",
  );
  await page
    .getByRole("button", { name: "Open broken.pptx", exact: true })
    .click();
  await expect(page.locator("#document-detail")).toContainText(
    "Damaged or unsupported Office package",
  );
  await page.getByRole("button", { name: "Open old.doc", exact: true }).click();
  await expect(page.locator("#document-detail")).toContainText(
    "Save a .docx or .pptx copy",
  );
  await page
    .getByRole("button", { name: "Open binary.py", exact: true })
    .click();
  await expect(page.locator("#document-detail")).toContainText("binary data");
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#browse-filters").evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  await page.locator("#type-filter").selectOption("docx");
  await expect(page.locator(".document-row")).toHaveCount(2);
});
