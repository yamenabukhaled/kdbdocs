import { test, expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

test("recent collection cap, full grid, focused file grids and collection-only Firebase descriptions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    (window as any).LanguageModel = {
      availability: async () => "available",
      create: async () => ({
        destroy() {},
        prompt: async () =>
          JSON.stringify({
            description: "Manufacturing notes.",
            quote: "Manufacturing",
          }),
      }),
    };
  });
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
  for (let i = 0; i < 7; i++) {
    if (!(await page.locator("#new-category").isVisible()))
      await page.locator("#home-filter").click();
    await page.locator("#new-category").click();
    await page.locator("#category-name").fill(`Collection ${i}`);
    await page.locator("#save-category").click();
    await expect(page.locator("#category-dialog")).not.toBeVisible();
  }
  await expect(page.locator("#category-list .collection-card")).toHaveCount(5);
  await page.locator("#collections-filter").click();
  await expect(
    page.locator("#category-list.collections-grid .collection-card"),
  ).toHaveCount(7);
  await page.screenshot({
    path: "test-results/all-collections-grid.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Open collection Collection 6", exact: true })
    .click();
  await expect(page.locator("#view-title")).toHaveText("Collection 6");
  await page.locator("#home-filter").click();
  await expect(page.locator("#category-list .collection-card")).toHaveCount(5);
  await expect(
    page.locator("#category-list .collection-card").first(),
  ).toHaveAccessibleName("Open collection Collection 6");
  await page.reload();
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await expect(
    page.locator("#category-list .collection-card").first(),
  ).toHaveAccessibleName("Open collection Collection 6");
  const root = await mkdtemp(
    join(resolve("test-results"), "collection-folders-"),
  );
  await mkdir(join(root, "Week1"));
  await mkdir(join(root, "Week2"));
  await writeFile(
    join(root, "Week1", "a.txt"),
    "Manufacturing processes notes.",
  );
  await writeFile(
    join(root, "Week2", "b.txt"),
    "Manufacturing tools overview.",
  );
  await page.locator("#library-folder").setInputFiles(root);
  await page.locator("#folder-auto").uncheck();
  await page.locator("#confirm-folder").click();
  await expect(page.locator("#document-count")).toHaveText("2");
  await expect(page.locator("#home-filter")).toBeEnabled();
  for (const name of ["a.txt", "b.txt"]) {
    await page
      .getByRole("combobox", { name: `Collection for ${name}`, exact: true })
      .selectOption({ label: "Collection 6" });
    await expect(page.locator("#home-filter")).toBeEnabled();
  }
  await page.locator("#all-filter").click();
  await expect(page.locator(".home-tools")).toBeHidden();
  await page.locator("#browse-filters").evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  await page.locator("#view-mode").selectOption("list");
  await page.locator("#collections-filter").click();
  await page
    .getByRole("button", { name: "Open collection Collection 6", exact: true })
    .click();
  await expect(page.locator("#view-title")).toHaveText("Collection 6");
  await expect(page.locator("#document-list")).toHaveClass(/document-grid/);
  await expect(page.locator(".document-row")).toHaveCount(2);
  await expect(page.locator(".home-tools")).toBeHidden();
  await expect(page.locator("#folder-shelf")).toHaveCount(0);
  await expect(page.locator("#open-upload-context")).toBeVisible();
  await page.screenshot({
    path: "test-results/focused-collection-grid.png",
    fullPage: true,
  });
  await page.locator("#collections-filter").click();
  await page
    .getByRole("button", {
      name: "Describe collection Collection 6 locally",
      exact: true,
    })
    .click();
  await expect(page.locator("#category-list")).toContainText(
    "Manufacturing notes.",
  );
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.locator("#home-filter").click();
  await page.screenshot({
    path: "test-results/recent-collections-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/recent-collections-mobile.png",
    fullPage: true,
  });
});
