import { test, expect } from "@playwright/test";

// Feature 3: dated items found on the device, listed on Home. Model double only.
test("Coming up lists upcoming items, hides past ones, dismiss persists, re-read is local", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const iso = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const w = window as any;
    w.__summaries = 0;
    w.LanguageModel = {
      availability: async () => "available",
      create: async () => ({
        destroy() {},
        prompt: async (messages: any[]) => {
          const prompt = messages
            .flatMap((m) => m.content.map((c: any) => c.value))
            .join("");
          const data = JSON.parse(prompt.split("\nDATA=")[1]);
          w.__summaries++;
          const dates =
            data.name === "invoice.md"
              ? [
                  { what: "Electricity bill due", date: iso(4) },
                  { what: "Last month's bill", date: iso(-20) },
                ]
              : data.name === "trip.md"
                ? [{ what: "Winter flight", date: iso(30) }]
                : [];
          return JSON.stringify({
            summary: `About ${data.name}.`,
            topics: [],
            sensitive: false,
            sensitiveReason: "",
            dates,
          });
        },
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
  await expect(page.locator("#workspace-message")).toContainText("ready");
  await page.locator("#library-files").setInputFiles(
    ["invoice.md", "trip.md", "notes.md"].map((name) => ({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(`text of ${name}`),
    })),
  );
  // Keep everything on the device for this run.
  await page
    .locator("#organize-panel")
    .getByRole("button", { name: "Keep everything on this device" })
    .click();
  await expect(page.locator("#organize-panel")).toContainText(
    "Nothing was sorted yet",
  );

  const list = page.locator("#coming-up-list li");
  await expect(page.locator("#coming-up")).toBeVisible();
  await expect(list).toHaveCount(2);
  await expect(list.nth(0)).toContainText("Electricity bill due");
  await expect(list.nth(0)).toContainText("invoice.md");
  await expect(list.nth(1)).toContainText("Winter flight");
  await expect(page.locator("#coming-up")).not.toContainText(
    "Last month's bill",
  );

  // Dismiss persists across reload.
  await page.getByRole("button", { name: "Dismiss Winter flight" }).click();
  await expect(list).toHaveCount(1);
  await page.reload();
  await expect(page.locator("#workspace-message")).toContainText("ready");
  await expect(page.locator("#coming-up-list li")).toHaveCount(1);

  // Clicking an item opens its file.
  await page
    .getByRole("button", { name: "Electricity bill due", exact: true })
    .click();
  await expect(page.locator("#document-detail h2")).toHaveText("invoice.md");

  // Re-read files runs on the device only.
  await page.locator("#open-settings").click();
  await page.locator("#reread-files").click();
  await expect(page.locator("#workspace-message")).toContainText(
    "Re-read 3 files on this device.",
  );
  expect(await page.evaluate(() => (window as any).__summaries)).toBe(3);
  expect(outbound).toEqual([]);
});
