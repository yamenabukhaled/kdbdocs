import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import PDFDocument from "pdfkit";
import { mkdir, writeFile } from "node:fs/promises";

test("empty library, category editor, selected document and settings pass automated WCAG checks", async ({
  page,
}, testInfo) => {
  const observations: unknown[] = [];
  await page.goto("/");
  await page.locator("#open-upload").click();
  await page.locator("#auto-organize").uncheck();
  await page.locator("#close-upload").click();
  await page.locator("#all-filter").click();
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  const scan = async (state: string) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    observations.push({
      state,
      violationCount: results.violations.length,
      passedRules: results.passes.length,
      manualReviewRuleIds: results.incomplete.map((item) => item.id),
    });
    await testInfo.attach(`accessibility-${state}.json`, {
      body: JSON.stringify({ state, violations: results.violations }, null, 2),
      contentType: "application/json",
    });
    expect(
      results.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  };
  await scan("empty");
  if (!(await page.locator("#new-category").isVisible()))
    await page.locator("#home-filter").click();
  await page.locator("#new-category").click();
  await scan("category-editor");
  await page.locator("#category-name").fill("Coursework");
  await page.locator("#save-category").click();
  await expect(page.locator("#category-dialog")).not.toBeVisible();
  await page.locator("#library-files").setInputFiles({
    name: "example.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic assigned reading for accessibility checks."),
  });
  await expect(page.locator("#workspace-message")).toContainText(
    "documents saved",
  );
  await scan("selected");
  await page.locator("#open-settings").click();
  await scan("settings");
  await mkdir("validation", { recursive: true });
  await writeFile(
    `validation/accessibility-${process.env.LIBRARY_TEST_PRODUCTION ? "production" : "development"}.json`,
    JSON.stringify(
      {
        note: "Automated checks of four states, not a claim of complete WCAG conformance; manual review is still needed.",
        observations,
      },
      null,
      2,
    ),
  );
});

test("encrypted PDFs stay manual with a specific unlock-copy error", async ({
  page,
}) => {
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      userPassword: "synthetic-test-only",
      ownerPassword: "synthetic-owner-only",
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.text("Synthetic encrypted PDF. No private content.");
    document.end();
  });
  await page.goto("/");
  await page.locator("#open-upload").click();
  await page.locator("#auto-organize").uncheck();
  await page.locator("#close-upload").click();
  await page.locator("#all-filter").click();
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  const outbound: string[] = [];
  await page.route("**/*", (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:5190/")) {
      outbound.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page
    .locator("#library-files")
    .setInputFiles({ name: "locked.pdf", mimeType: "application/pdf", buffer });
  await expect(page.locator("#workspace-message")).toContainText(
    "documents saved",
  );
  await expect(page.locator("#document-detail")).toContainText(
    "Password-protected PDF",
  );
  await expect(page.locator("#document-detail")).toContainText("0 of");
  await expect(page.locator("#document-detail pre")).toContainText(
    "No extractable text",
  );
  expect(outbound).toEqual([]);
});
