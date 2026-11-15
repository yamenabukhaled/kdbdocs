import { test, expect } from "@playwright/test";

// Feature 1: show what the AI already knows. Model doubles only.
test("summaries, topic chips, topic filter and collection descriptions", async ({
  page,
}) => {
  test.skip(
    !!process.env.LIBRARY_TEST_PRODUCTION,
    "Uses localhost debug App Check attestation.",
  );
  await page.addInitScript(() => {
    const topics: Record<string, string[]> = {
      "regression.md": ["statistics", "regression"],
      "lab.R": ["statistics", "R"],
      "bread.md": ["baking"],
    };
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
            summary: `Summary of ${data.name} written on the device.`,
            topics: topics[data.name] ?? [],
            sensitive: false,
            sensitiveReason: "",
          });
        },
      }),
    };
  });
  let outbound = 0;
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:5190/")) return route.continue();
    outbound++;
    if (url.includes("exchangeDebugToken"))
      return route.fulfill({ json: { token: "t", ttl: "3600s" } });
    if (url.includes(":generateContent")) {
      const sent = JSON.parse(
        JSON.parse(route.request().postData()!).contents[0].parts[0].text.split(
          "\nDATA=",
        )[1],
      );
      const plan = {
        newCollections: [
          {
            key: "n1",
            name: "Coursework",
            description: "Lectures and labs for university courses.",
          },
          { key: "n2", name: "Personal", description: "Recipes and home." },
        ],
        placements: sent.files.map((f: any) => ({
          file: f.ref,
          collection: f.name === "bread.md" ? "n2" : "n1",
          confidence: "high",
        })),
        questions: [],
      };
      return route.fulfill({
        json: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: JSON.stringify(plan) }],
              },
              finishReason: "STOP",
            },
          ],
        },
      });
    }
    return route.abort();
  });
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText("ready");
  await page.locator("#library-files").setInputFiles(
    ["regression.md", "lab.R", "bread.md"].map((name) => ({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(`content of ${name}`),
    })),
  );
  await page
    .locator("#organize-panel")
    .getByRole("button", { name: "Allow cloud sorting" })
    .click();
  await expect(page.locator("#organize-panel")).toContainText("Sorted 3 files");
  const afterSort = outbound;

  // Collection cards show the description from sorting.
  await expect(
    page.getByRole("button", { name: "Open collection Coursework" }),
  ).toContainText("Lectures and labs for university courses.");

  // Cards show topic chips; the file view shows summary and topics.
  await page.locator("#all-filter").click();
  await expect(
    page.getByRole("button", { name: "Show files about statistics" }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Open regression.md" }).click();
  const summary = page.locator(".file-summary");
  await expect(summary).toContainText(
    "Summary of regression.md written on the device.",
  );
  await expect(
    summary.getByRole("button", { name: /regression/ }),
  ).toBeVisible();

  // Clicking a topic filters the list; the × clears it.
  await summary
    .getByRole("button", { name: "Show files about statistics" })
    .click();
  await expect(page.locator("#view-title")).toHaveText(
    "Files about statistics",
  );
  await expect(page.locator(".document-row")).toHaveCount(2);
  await page.locator("#topic-filter-chip").click();
  await expect(page.locator(".document-row")).toHaveCount(3);

  // None of this sent anything.
  expect(outbound).toBe(afterSort);
});
