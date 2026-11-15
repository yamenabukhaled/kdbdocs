import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
function makePdf(pages: (string | null)[]) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((text, index) => {
    const stream =
      text === null
        ? ""
        : `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  return Buffer.from(
    pdf +
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
  );
}
async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await page.locator("#open-upload").click();
  await page.locator("#auto-organize").uncheck();
  await page.locator("#close-upload").click();
  await page.locator("#all-filter").click();
}
async function category(page: Page, name = "Coursework", localOnly = true) {
  if (!(await page.locator("#new-category").isVisible()))
    await page.locator("#home-filter").click();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.locator("#category-name").fill(name);
  await page
    .locator("#category-description")
    .fill("Assigned reading for classes");
  if (!localOnly) await page.locator("#category-private").uncheck();
  await page.locator("#save-category").click();
  await expect(page.locator("#category-dialog")).not.toBeVisible();
}
async function textFile(
  page: Page,
  name = "reading.txt",
  text = "assigned reading about circuits",
) {
  await page
    .locator("#library-files")
    .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.locator("#workspace-message")).toContainText(
    "documents saved locally",
  );
  await expect(page.locator("#document-detail h2")).toHaveText(name);
}
async function model(page: Page, mode = "valid") {
  await page.addInitScript(
    ({ mode }) => {
      const w = window as unknown as {
        __mode: string;
        __prompts: string[];
        LanguageModel: unknown;
      };
      w.__mode = mode;
      w.__prompts = [];
      w.LanguageModel = {
        availability: async () =>
          w.__mode === "unavailable" ? "unavailable" : "available",
        create: async (options: { signal?: AbortSignal } = {}) => ({
          destroy() {},
          async prompt(messages: { content: { value: string }[] }[]) {
            const prompt = messages
              .flatMap((message) => message.content.map((part) => part.value))
              .join("");
            w.__prompts.push(prompt);
            if (w.__mode === "delay")
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, 1500);
                options.signal?.addEventListener("abort", () => {
                  clearTimeout(timer);
                  reject(new DOMException("Cancelled", "AbortError"));
                });
              });
            if (options.signal?.aborted)
              throw new DOMException("Cancelled", "AbortError");
            if (w.__mode === "quota")
              throw new DOMException("Too long", "QuotaExceededError");
            const data = JSON.parse(prompt.split("\nDATA=")[1]);
            return JSON.stringify({
              categoryId: data.categories[0].id,
              reason: "Assigned reading matches the category.",
              quote:
                w.__mode === "invalid"
                  ? "INVENTED QUOTE"
                  : data.excerpts[0].text.slice(0, 30),
              needsIntent: false,
            });
          },
        }),
      };
    },
    { mode },
  );
}
async function blockExternal(page: Page) {
  const outbound: string[] = [];
  await page.route("**/*", (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:5190/")) {
      outbound.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  return outbound;
}

test("mixed PDF/text library persists; manual review and undo stay local", async ({
  page,
}) => {
  const outbound = await blockExternal(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await category(page);
  await page.locator("#library-files").setInputFiles([
    {
      name: "private.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "PRIVATE_DOCUMENT_SENTINEL<script>window.pwned=true</script>",
      ),
    },
    {
      name: "reading.pdf",
      mimeType: "application/pdf",
      buffer: makePdf(["Hello local PDF", null]),
    },
    {
      name: "broken.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("broken"),
    },
    {
      name: "no-text.pdf",
      mimeType: "application/pdf",
      buffer: makePdf([null]),
    },
  ]);
  await expect(page.locator("#workspace-message")).toContainText(
    "4 documents saved",
  );
  await expect(page.locator(".document-row")).toHaveCount(4);
  await expect(page.locator("#document-detail pre")).toContainText("<script>");
  expect(
    await page.evaluate(() => (window as unknown as { pwned: boolean }).pwned),
  ).toBeUndefined();
  await page
    .getByRole("combobox", { name: "Category for private.txt" })
    .selectOption({ label: "Coursework" });
  await expect(page.locator("#workspace-message")).toContainText(
    "Decision saved",
  );
  await page
    .getByRole("button", { name: "Open reading.pdf", exact: true })
    .click();
  await expect(page.locator("#document-detail pre")).toContainText(
    "Hello local PDF",
  );
  await expect(page.locator("#document-detail")).toContainText(
    "2 of 2 pages read",
  );
  await page.reload();
  await expect(page.locator(".document-row")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Open private.txt", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Category for private.txt" }),
  ).not.toHaveValue("");
  await page
    .getByRole("button", { name: "Remove from library", exact: true })
    .click();
  await expect(page.locator(".document-row")).toHaveCount(3);
  await page.reload();
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#undo-workspace").click();
  await expect(page.locator(".document-row")).toHaveCount(4);
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/overnight-desktop.png",
    fullPage: true,
  });
});

test("backup download, preview and restore round trip into an empty browser", async ({
  page,
  browser,
}) => {
  await open(page);
  await category(page);
  await textFile(page);
  await page
    .getByRole("combobox", { name: "Category for reading.txt" })
    .selectOption({ label: "Coursework" });
  await expect(page.locator("#workspace-message")).toContainText(
    "Decision saved",
  );
  await page.locator("#open-settings").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-backup").click();
  const download = await downloadPromise;
  const buffer = await readFile((await download.path())!);
  const archive = JSON.parse(buffer.toString());
  expect(archive.version).toBe(2);
  expect(archive.events).toHaveLength(1);
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await open(fresh);
  await fresh.locator("#open-settings").click();
  await fresh.locator("#restore-file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer,
  });
  await expect(fresh.locator("#restore-summary")).toContainText("1 documents");
  await expect(fresh.locator(".document-row")).toHaveCount(0);
  await fresh.locator("#restore-mode").selectOption("replace");
  await fresh.locator("#confirm-restore").click();
  await expect(fresh.locator(".document-row")).toHaveCount(1);
  await fresh.getByRole("button", { name: "Open reading.txt" }).click();
  await expect(fresh.locator("#document-detail pre")).toContainText(
    "assigned reading",
  );
  await context.close();
});

test("bounded parsing and sampling report separate coverage limits", async ({
  page,
}) => {
  await open(page);
  await page.locator("#library-files").setInputFiles([
    {
      name: "long.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("A".repeat(500_050)),
    },
    {
      name: "oversized.txt",
      mimeType: "text/plain",
      buffer: Buffer.alloc(2_000_001),
    },
    {
      name: "many.pdf",
      mimeType: "application/pdf",
      buffer: makePdf(Array.from({ length: 151 }, () => "page text")),
    },
  ]);
  await expect(page.locator("#workspace-message")).toContainText(
    "3 documents saved",
  );
  await expect(page.locator("#document-detail")).toContainText(
    "Extraction capped at 500,000 of 500,050",
  );
  await expect(page.locator("#document-detail pre")).toHaveText(
    "A".repeat(20_000),
  );
  await page.getByRole("button", { name: "Open many.pdf" }).click();
  await expect(page.locator("#document-detail")).toContainText(
    "150 of 151 pages read",
  );
  await page.getByRole("button", { name: "Open oversized.txt" }).click();
  await expect(page.locator("#document-detail")).toContainText(
    "No contents were read",
  );
});

test("blocked storage and failed writes never report success", async ({
  page,
}) => {
  await open(page);
  await category(page, "Saved");
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  if (!(await page.locator("#new-category").isVisible()))
    await page.locator("#home-filter").click();
  await page.locator("#new-category").click();
  await page.locator("#category-name").fill("Unsaved");
  await page.locator("#save-category").click();
  await expect(page.locator("#workspace-message")).toContainText(
    "Could not save locally",
  );
  await page.reload();
  await expect(page.locator("#category-list")).toContainText("Saved");
  await expect(page.locator("#category-list")).not.toContainText("Unsaved");
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("Blocked");
      },
    });
  });
  await page.reload();
  await expect(page.locator("#workspace-message")).toContainText(
    "Local storage could not be opened",
  );
  await expect(page.locator("#library-files")).toBeDisabled();
});

test("stale tabs cannot overwrite each other", async ({ page, context }) => {
  await open(page);
  const second = await context.newPage();
  await open(second);
  await category(page, "First tab");
  if (!(await second.locator("#new-category").isVisible()))
    await second.locator("#home-filter").click();
  await second.locator("#new-category").click();
  await second.locator("#category-name").fill("Second tab");
  await second.locator("#save-category").click();
  await expect(second.locator("#workspace-message")).toContainText(
    "Another tab changed",
  );
  await second.reload();
  await expect(second.locator("#category-list")).toContainText("First tab");
  await expect(second.locator("#category-list")).not.toContainText(
    "Second tab",
  );
});

test("mobile document view fits, opens and returns to library", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await category(page);
  await textFile(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/overnight-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".library-panel")).toBeVisible();
});
