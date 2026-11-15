import { test, expect } from "@playwright/test";

// Feature 4: "Find it for me" picks files by description on the device.
test("find by description returns device-picked matches and sends nothing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__findPrompts = [];
    w.LanguageModel = {
      availability: async () => "available",
      create: async () => ({
        destroy() {},
        prompt: async (messages: any[]) => {
          const prompt = messages
            .flatMap((m) => m.content.map((c: any) => c.value))
            .join("");
          const data = JSON.parse(prompt.split("\nDATA=")[1]);
          if (prompt.startsWith("Describe this document"))
            return JSON.stringify({
              summary:
                data.name === "attention.md"
                  ? "Notes on a transformer paper, read out of curiosity."
                  : `About ${data.name}.`,
              topics: [],
              sensitive: false,
              sensitiveReason: "",
              dates: [],
            });
          w.__findPrompts.push(prompt);
          const match = data.files.find((f: any) => f.name === "attention.md");
          return JSON.stringify({
            matches: [
              { id: match.id, reason: "Transformer notes read for fun." },
            ],
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
    ["attention.md", "recipe.md", "stats.md"].map((name) => ({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(`body of ${name}`),
    })),
  );
  await page
    .locator("#organize-panel")
    .getByRole("button", { name: "Keep everything on this device" })
    .click();
  await expect(page.locator("#organize-panel")).toContainText(
    "Nothing was sorted yet",
  );

  await page.locator("#all-filter").click();
  await expect(page.locator("#find-it")).toBeHidden();
  await page
    .locator("#document-search")
    .fill("paper I read for fun about transformers");
  await expect(page.locator("#find-it")).toBeVisible();
  await page.locator("#find-it").click();
  const results = page.locator("#find-results");
  await expect(results).toContainText("picked on this device");
  await expect(
    results.getByRole("button", { name: "attention.md" }),
  ).toBeVisible();
  await expect(results).toContainText("Transformer notes read for fun.");
  const prompts = await page.evaluate(() => (window as any).__findPrompts);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("paper I read for fun about transformers");
  await results.getByRole("button", { name: "attention.md" }).click();
  await expect(page.locator("#document-detail h2")).toHaveText("attention.md");
  expect(outbound).toEqual([]);
});
