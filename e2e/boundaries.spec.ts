import { test, expect, type Page } from "@playwright/test";

// Privacy-boundary mechanics for the organize flow. Model doubles only.

async function deviceModel(page: Page) {
  await page.addInitScript(() => {
    (window as any).LanguageModel = {
      availability: async () => "available",
      create: async () => ({
        destroy() {},
        prompt: async (messages: any[]) => {
          const prompt = messages
            .flatMap((m) => m.content.map((c: any) => c.value))
            .join("");
          const data = JSON.parse(prompt.split("\nDATA=")[1]);
          return JSON.stringify({
            summary: `Notes about ${data.name}.`,
            topics: ["notes"],
            sensitive: false,
            sensitiveReason: "",
          });
        },
      }),
    };
  });
}

async function importTwo(page: Page) {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await page.locator("#library-files").setInputFiles([
    {
      name: "one.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("BODY-ONE lecture notes"),
    },
    {
      name: "two.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("BODY-TWO meeting notes"),
    },
  ]);
}

test("absent on-device model: files stay saved, nothing is read or sent", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "LanguageModel", {
      value: undefined,
      configurable: true,
    });
  });
  const outbound: string[] = [];
  await page.route("**/*", (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:5190/")) {
      outbound.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await importTwo(page);
  await expect(page.locator("#workspace-message")).toContainText(
    "on-device model is unavailable",
  );
  await expect(page.locator("#organize-panel")).not.toContainText("cloud help");
  await expect(page.locator("#document-count")).toHaveText("2");
  expect(outbound).toEqual([]);
});

test("cancelling during App Check acquisition prevents the plan request", async ({
  page,
}) => {
  test.skip(
    !!process.env.LIBRARY_TEST_PRODUCTION,
    "Uses localhost debug attestation.",
  );
  await deviceModel(page);
  let dispatched = 0;
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:5190/")) return route.continue();
    if (url.includes("exchangeDebugToken")) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return route.fulfill({
        json: { token: "isolated-test-token", ttl: "3600s" },
      });
    }
    if (url.includes(":generateContent")) dispatched++;
    return route.abort();
  });
  await importTwo(page);
  const token = page.waitForRequest((r) =>
    r.url().includes("exchangeDebugToken"),
  );
  await page
    .locator("#organize-panel")
    .getByRole("button", { name: "Allow cloud sorting" })
    .click();
  await token;
  await page.locator("#cancel-analysis").click();
  await page.waitForTimeout(1500);
  expect(dispatched).toBe(0);
  await page.locator("#all-filter").click();
  await expect(
    page
      .getByRole("combobox", { name: "Collection for one.txt", exact: true })
      .locator("option:checked"),
  ).toHaveText("Unassigned");
});

test("turning on workspace Local only in another tab during App Check blocks the request", async ({
  page,
  context,
}) => {
  test.skip(
    !!process.env.LIBRARY_TEST_PRODUCTION,
    "Uses localhost debug attestation.",
  );
  await deviceModel(page);
  let dispatched = 0;
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:5190/")) return route.continue();
    if (url.includes("exchangeDebugToken")) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return route.fulfill({
        json: { token: "isolated-test-token", ttl: "3600s" },
      });
    }
    if (url.includes(":generateContent")) dispatched++;
    return route.abort();
  });
  await importTwo(page);
  await expect(page.locator("#organize-panel")).toContainText("cloud help");
  const token = page.waitForRequest((r) =>
    r.url().includes("exchangeDebugToken"),
  );
  await page
    .locator("#organize-panel")
    .getByRole("button", { name: "Allow cloud sorting" })
    .click();
  await token;
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  // Another tab protects the workspace before the token arrives.
  await other.locator("#open-settings").click();
  await other.locator("#global-private").check();
  await expect(other.locator("#workspace-message")).toContainText(
    "Workspace policy saved",
  );
  await page.waitForTimeout(3500);
  expect(dispatched).toBe(0);
});
