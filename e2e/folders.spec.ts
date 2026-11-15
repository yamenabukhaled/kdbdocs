import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await page.locator("#all-filter").click();
}
async function fixture(files: Record<string, string | Buffer>) {
  const parent = resolve("test-results");
  await mkdir(parent, { recursive: true });
  const folder = join(
    await mkdtemp(join(parent, "folder-fixture-")),
    "Example folder",
  );
  await mkdir(folder);
  for (const [name, contents] of Object.entries(files)) {
    const destination = join(folder, name);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await writeFile(destination, contents);
  }
  return folder;
}
test("native folder picker previews nested files and duplicates, preserves searchable paths and backup recovery without network", async ({
  page,
  browser,
}) => {
  const folder = await fixture({
    "class/notes.txt": "Course circuits overview",
    "research/notes.txt": "Independent physics overview",
    "code/analyse.py": "print('safe literal text')",
    "font.ttf": "font",
    "large.pdf": Buffer.alloc(20_000_001),
    "node_modules/ignored.js": "not read",
    "desktop.ini": "metadata",
  });
  const outbound: string[] = [];
  await page.route("**/*", (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:5190/")) {
      outbound.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await open(page);
  await page.locator("#library-folder").setInputFiles(folder);
  await expect(page.locator("#folder-summary")).toContainText("5 files found");
  await expect(page.locator("#folder-summary")).toContainText("3 supported");
  await expect(page.locator(".folder-file-row")).toHaveCount(5);
  await expect(page.locator("#folder-selection")).toContainText("3 selected");
  await expect(page.locator(".document-row")).toHaveCount(0);
  await expect(page.locator("#folder-issues")).toContainText("ignored");
  await expect(page.getByRole("checkbox", { name: /font.ttf/ })).toBeDisabled();
  await page.screenshot({
    path: "test-results/folder-preview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/folder-preview-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1050 });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags([
          "wcag2a",
          "wcag2aa",
          "wcag21aa",
          "wcag22aa",
          "best-practice",
        ])
        .analyze()
    ).violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.locator("#folder-auto").uncheck();
  await page.locator("#confirm-folder").click();
  await expect(page.locator("#workspace-message")).toContainText(
    "3 documents saved locally",
  );
  await expect(page.locator(".document-row")).toHaveCount(3);
  await page
    .getByRole("button", {
      name: "Open Example folder/research/notes.txt",
      exact: true,
    })
    .click();
  await expect(page.locator("#document-detail pre")).toContainText(
    "Independent physics",
  );
  await expect(page.locator("#document-detail .document-path")).toContainText(
    "research/notes.txt",
  );
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#document-search").fill("research");
  await expect(page.locator("#search-status")).toContainText(
    "1 matching documents",
  );
  await expect(page.locator(".document-row")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("#document-detail .document-path")).toContainText(
    "research/notes.txt",
  );
  await page.locator("#library-folder").setInputFiles(folder);
  await expect(page.locator("#folder-selection")).toContainText("0 selected");
  await expect(page.locator("#confirm-folder")).toBeDisabled();
  await page.locator("#close-folder").click();
  await page.locator("#open-settings").click();
  const downloaded = page.waitForEvent("download");
  await page.locator("#export-backup").click();
  const buffer = await readFile((await (await downloaded).path())!);
  expect(
    JSON.parse(buffer.toString()).workspace.documents.every(
      (d: { relativePath?: string }) =>
        d.relativePath?.startsWith("Example folder/"),
    ),
  ).toBe(true);
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await open(fresh);
  await fresh.locator("#open-settings").click();
  await fresh.locator("#restore-file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer,
  });
  await expect(fresh.locator("#restore-summary")).toContainText("3 documents");
  await fresh.locator("#confirm-restore").click();
  await fresh
    .getByRole("button", {
      name: "Open Example folder/class/notes.txt",
      exact: true,
    })
    .click();
  await expect(fresh.locator("#document-detail pre")).toContainText(
    "Course circuits",
  );
  await context.close();
  expect(outbound).toEqual([]);
});

test("directory drops preview before import, consume multiple reader pages and cancel without saving", async ({
  page,
}) => {
  await open(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => {
    const children = Array.from({ length: 105 }, (_, index) => ({
      name: `${index}.txt`,
      isFile: true,
      isDirectory: false,
      file(success: (f: File) => void) {
        success(new File(["example"], `${index}.txt`));
      },
    }));
    const root = {
      name: "Dropped",
      isDirectory: true,
      isFile: false,
      createReader() {
        let offset = 0;
        return {
          readEntries(success: (entries: unknown[]) => void) {
            const batch = children.slice(offset, offset + 100);
            offset += 100;
            success(batch);
          },
        };
      },
    };
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        items: [{ kind: "file", webkitGetAsEntry: () => root }],
        files: [],
      },
    });
    document.querySelector("#drop-zone")!.dispatchEvent(event);
  });
  await expect(page.locator("#folder-summary")).toContainText(
    "105 files found",
  );
  await expect(page.locator("#folder-selection")).toContainText("4 batch(es)");
  await page.locator("#close-folder").click();
  await expect(page.locator(".document-row")).toHaveCount(0);
  await page.evaluate(() => {
    const root = {
      name: "Waiting",
      isDirectory: true,
      isFile: false,
      createReader: () => ({ readEntries() {} }),
    };
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        items: [{ kind: "file", webkitGetAsEntry: () => root }],
        files: [],
      },
    });
    document.querySelector("#drop-zone")!.dispatchEvent(event);
  });
  await expect(page.locator("#folder-summary")).toContainText("Scanning");
  await page.locator("#cancel-folder").click();
  await expect(page.locator("#folder-dialog")).not.toBeVisible();
  await expect(page.locator(".document-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("native Chrome directory drag opens a folder preview", async ({
  page,
}) => {
  const longName = `${"long-name-".repeat(22)}.pdf`;
  const folder = await fixture({
    "nested/one.txt": "native folder drop",
    "two.py": "print('local')",
    [longName]: "long path fixture",
  });
  await open(page);
  await page.locator("#home-filter").click();
  const box = await page.locator("#drop-zone").boundingBox();
  const session = await page.context().newCDPSession(page);
  const data = { items: [], files: [folder], dragOperationsMask: 1 };
  for (const type of ["dragEnter", "dragOver", "drop"])
    await session.send("Input.dispatchDragEvent", {
      type,
      x: box!.x + 50,
      y: box!.y + 30,
      data,
    });
  await expect(page.locator("#folder-summary")).toContainText("3 files found");
  await expect(page.locator(".folder-file-row")).toHaveCount(3);
  const longRow = page
    .locator(".folder-file-row")
    .filter({ hasText: longName });
  if (await longRow.locator("input").isDisabled())
    await expect(longRow).toContainText("Browser could not access");
  await expect(page.locator(".document-row")).toHaveCount(0);
  await page.locator("#close-folder").click();
  await session.detach();
});

test("folders larger than one batch import as one undoable operation; stop retains completed files", async ({
  page,
}) => {
  const folder = await fixture(
    Object.fromEntries(
      Array.from({ length: 31 }, (_, i) => [`${i}.txt`, "batch content"]),
    ),
  );
  await open(page);
  await page.locator("#library-folder").setInputFiles(folder);
  await expect(page.locator("#folder-selection")).toContainText("2 batch(es)");
  await page.locator("#folder-auto").uncheck();
  await page.locator("#confirm-folder").click();
  await expect(page.locator("#workspace-message")).toContainText(
    "31 documents saved locally",
  );
  await expect(page.locator("#document-count")).toHaveText("31");
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#undo-workspace").click();
  await expect(page.locator("#document-count")).toHaveText("0");
  await page.evaluate(() => {
    const read = Blob.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return read.call(this);
    };
  });
  await page.locator("#library-folder").setInputFiles(folder);
  await expect(page.locator("#folder-selection")).toContainText("31 selected");
  await page.locator("#folder-auto").uncheck();
  await page.locator("#confirm-folder").click();
  await page.locator("#stop-import").click();
  await expect(page.locator("#workspace-message")).toContainText(
    "Import stopped. 1 documents saved locally",
  );
  await expect(page.locator("#document-count")).toHaveText("1");
});
