import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("library search resets filters, supports shortcuts and retains card focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await page.locator("#open-upload").click();
  await page.locator("#auto-organize").uncheck();
  await page.locator("#close-upload").click();
  await page.locator("#library-files").setInputFiles([
    {
      name: "lecture-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Manufacturing processes and practical engineering notes.",
      ),
    },
    {
      name: "research-notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Research methods and sample collection."),
    },
  ]);
  await expect(page.locator("#document-count")).toHaveText("2");
  await expect(page.locator("#document-search")).toBeEnabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#document-search").blur();
  await page.keyboard.press("/");
  await expect(page.locator("#document-search")).toBeFocused();
  await page.locator("#document-search").fill("missing phrase");
  await expect(page.locator("#results-count")).toHaveText("0 documents");
  await page.locator("#reset-filters").click();
  await expect(page.locator("#results-count")).toHaveText("2 documents");
  await expect(page.locator("#document-search")).toBeFocused();
  await page.locator("#browse-filters").evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  await page.locator("#type-filter").selectOption("txt");
  await expect(page.locator("#results-count")).toHaveText("1 document");
  await page.locator("#reset-filters").click();
  const card = page.getByRole("button", {
    name: "Open lecture-notes.txt",
    exact: true,
  });
  await card.focus();
  await page.locator("#view-mode").evaluate((select: HTMLSelectElement) => {
    select.value = "list";
    select.dispatchEvent(new Event("change"));
  });
  await expect(card).toBeFocused();
  await page.locator("#browse-filters").evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  await page.locator("#view-mode").selectOption("grid");
  await page.screenshot({
    path: "test-results/ux-library-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/ux-library-mobile.png",
    fullPage: true,
  });
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
    .include("#library")
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await card.evaluate((node) => getComputedStyle(node).transitionDuration),
  ).toBe("0s");
});

test("home limits recent documents and places compact upload beside its heading", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await page.locator("#open-upload").click();
  await page.locator("#auto-organize").uncheck();
  await page.locator("#close-upload").click();
  await page.locator("#library-files").setInputFiles(
    [
      "Course notes",
      "Research methods",
      "Project brief",
      "Reading list",
      "Workshop",
      "Planning",
    ].map((name) => ({
      name: `${name}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(
        `Synthetic ${name.toLowerCase()} for design validation. A short overview with relevant context.`,
      ),
    })),
  );
  await expect(page.locator("#document-count")).toHaveText("6");
  await expect(page.locator("#document-search")).toBeEnabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("link", { name: "KDBDocs home" })).toBeVisible();
  const cards = await page.locator("#document-list").boundingBox();
  const upload = await page.locator("#drop-zone").boundingBox();
  expect(upload!.y + upload!.height).toBeLessThanOrEqual(cards!.y);
  await expect(page.locator(".document-row")).toHaveCount(5);
  expect(upload!.width).toBeLessThanOrEqual(340);
  expect(upload!.x).toBeGreaterThan(100);
  await page.screenshot({
    path: "test-results/notebook-library-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#open-upload").click();
  await page.locator("#choose-folder").scrollIntoViewIfNeeded();
  await expect(page.locator("#choose-folder")).toBeVisible();
  await page.locator("#close-upload").click();
  await page.screenshot({
    path: "test-results/notebook-library-mobile.png",
    fullPage: true,
  });
});

test("collection cards filter on click, keyboard and reduced motion; Home stays newest five", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await page.locator("#open-upload").click();
  await page.locator("#auto-organize").uncheck();
  await page.locator("#close-upload").click();
  for (const name of ["Coursework", "Research"]) {
    if (!(await page.locator("#new-category").isVisible()))
      await page.locator("#home-filter").click();
    await page.locator("#new-category").click();
    await page.locator("#category-name").fill(name);
    await page.locator("#save-category").click();
    await expect(page.locator("#category-dialog")).not.toBeVisible();
  }
  await expect(page.locator("#library-files")).toBeEnabled();
  await page.locator("#library-files").setInputFiles(
    Array.from({ length: 7 }, (_, i) => ({
      name: `file-${i}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`Document ${i}`),
    })),
  );
  await expect(page.locator("#document-count")).toHaveText("7");
  await expect(page.locator("#home-filter")).toBeEnabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".document-row")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "Open file-0.txt", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open file-6.txt", exact: true }),
  ).toBeVisible();
  const card = page.getByRole("button", {
    name: "Open collection Coursework",
    exact: true,
  });
  await card.hover();
  await expect(card.locator(".collection-label")).toHaveCSS("opacity", "1");
  await card.click();
  await expect(page.locator("#view-title")).toHaveText("Coursework");
  await expect(page.locator("#view-title")).toBeFocused();
  await expect(page.locator(".document-row")).toHaveCount(0);
  await page.locator("#all-filter").click();
  await expect(page.locator(".document-row")).toHaveCount(7);
  await page
    .getByRole("button", { name: "Open file-6.txt", exact: true })
    .click();
  await page
    .getByLabel("Collection of file-6.txt", { exact: true })
    .selectOption({ label: "Coursework" });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#home-filter").click();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#view-title")).toHaveText("Coursework");
  await expect(page.locator(".document-row")).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#collections-filter").click();
  await page
    .getByRole("button", { name: "Open collection Research", exact: true })
    .click();
  await expect(page.locator("#view-title")).toHaveText("Research");
  expect(
    await page
      .locator("#category-list")
      .evaluate((node) => node.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await page.locator("#home-filter").click();
  await expect(page.locator("#view-title")).toHaveText("Recently added");
  await expect(page.locator(".document-row")).toHaveCount(5);
  await page.screenshot({
    path: "test-results/home-collections-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/home-collections-mobile.png",
    fullPage: true,
  });
});

test("card collection picker saves without opening a document and supports undo and reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await page.locator("#open-upload").click();
  await page.locator("#auto-organize").uncheck();
  await page.locator("#close-upload").click();
  if (!(await page.locator("#new-category").isVisible()))
    await page.locator("#home-filter").click();
  await page.locator("#new-category").click();
  await page.locator("#category-name").fill("Coursework");
  await page.locator("#save-category").click();
  await expect(page.locator("#category-dialog")).not.toBeVisible();
  await expect(page.locator("#library-files")).toBeEnabled();
  await page.locator("#library-files").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "A private preview that should not appear on the card face.",
    ),
  });
  await expect(page.locator("#document-count")).toHaveText("1");
  await expect(page.locator("#home-filter")).toBeEnabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const picker = page.getByRole("combobox", {
    name: "Collection for notes.txt",
    exact: true,
  });
  await picker.selectOption({ label: "Coursework" });
  await expect(page.locator("#workspace-message")).toContainText(
    "Decision saved locally",
  );
  await expect(picker).toBeFocused();
  expect(await page.evaluate(() => location.hash)).toBe("");
  await expect(page.locator("#document-list .document-preview")).toBeHidden();
  await expect(page.locator("#document-list .document-path")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await expect(picker.locator("option:checked")).toHaveText("Coursework");
  await page.locator("#all-filter").click();
  await page.locator("#undo-workspace").click();
  await expect(picker.locator("option:checked")).toHaveText("Unassigned");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
    .include("#library")
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.locator("#home-filter").click();
  await page.screenshot({
    path: "test-results/collection-first-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/collection-first-mobile.png",
    fullPage: true,
  });
});
