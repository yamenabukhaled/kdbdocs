import { test, expect, type Page } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
async function selectFolder(page: Page) {
  const parent = resolve("test-results");
  await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(join(parent, "recovery-folder-"));
  await writeFile(join(folder, "01.txt"), "first file text");
  await writeFile(join(folder, "02.txt"), "second file text");
  await page.locator("#open-upload").click();
  const chooser = page.waitForEvent("filechooser");
  if (!(await page.locator("#upload-dialog[open]").count()))
    await page.locator("#open-upload").click();
  await page.locator("#choose-folder").click();
  await (await chooser).setFiles(folder);
  await expect(page.locator("#folder-selection")).toContainText("2 selected");
  await page.locator("#folder-auto").uncheck();
  return folder;
}
test("a second-file save failure remains visible after refresh and retry excludes the saved path", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  const folder = await selectFolder(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let writes = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "documents" && ++writes === 2)
        throw new DOMException("Full", "QuotaExceededError");
      return put.apply(this, args as Parameters<typeof put>);
    };
  });
  await page.locator("#confirm-folder").click();
  await expect(page.locator("#import-report-text")).toContainText(
    "1 of 2 files saved",
  );
  await expect(page.locator("#import-report-text")).toContainText(
    "Could not save locally",
  );
  await page.reload();
  await expect(page.locator("#import-report-text")).toContainText(
    "Could not save locally",
  );
  await expect(page.locator("#document-count")).toHaveText("1");
  const chooser = page.waitForEvent("filechooser");
  if (!(await page.locator("#upload-dialog[open]").count()))
    await page.locator("#open-upload").click();
  await page.locator("#choose-folder").click();
  await (await chooser).setFiles(folder);
  await expect(page.locator("#folder-selection")).toContainText("1 selected");
  await page.locator("#folder-auto").uncheck();
  await page.locator("#confirm-folder").click();
  await expect(page.locator("#import-report-text")).toContainText(
    "Import finished",
  );
  await expect(page.locator("#document-count")).toHaveText("2");
});
test("refresh midway through extraction reports interruption and reconciles the saved count", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await selectFolder(page);
  await page.evaluate(() => {
    const read = Blob.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === "02.txt")
        await new Promise((resolve) => setTimeout(resolve, 5000));
      return read.call(this);
    };
  });
  await page.locator("#confirm-folder").click();
  await expect(page.locator("#document-count")).toHaveText("1");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator("#import-report-text")).toContainText(
    "Import interrupted · 1 of 2 files saved",
  );
  await expect(page.locator("#import-report-text")).toContainText(
    "Reselect the folder",
  );
  await expect(page.locator("#document-count")).toHaveText("1");
});
test("a hanging local read becomes a file error and the next file still saves", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await selectFolder(page);
  await page.clock.install();
  await page.evaluate(() => {
    const read = Blob.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      return this.name === "01.txt"
        ? new Promise<ArrayBuffer>(() => {})
        : read.call(this);
    };
  });
  await page.locator("#confirm-folder").click();
  await expect(page.locator("#workspace-message")).toContainText(
    "Importing 1/2",
  );
  await page.clock.fastForward(30_001);
  await expect(page.locator("#document-count")).toHaveText("2");
  await expect(page.locator("#import-report-text")).toContainText(
    "1 file has extraction errors",
  );
  await expect(page.locator("#document-detail")).toContainText(
    "available offline",
  );
});
