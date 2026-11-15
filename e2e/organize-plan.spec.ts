import { test, expect } from "@playwright/test";

// Mechanics only: the on-device model and the cloud are test doubles.
// This proves routing, privacy boundary, auto-filing, questions and Undo — not sorting quality.
test("import → device summaries → one-time consent → filed immediately → inline question → preference → undo", async ({
  page,
}) => {
  test.skip(
    !!process.env.LIBRARY_TEST_PRODUCTION,
    "Uses localhost debug App Check attestation.",
  );
  await page.addInitScript(() => {
    const w = window as any;
    w.__localCalls = { summary: 0, place: 0 };
    w.LanguageModel = {
      availability: async () => "available",
      create: async () => ({
        destroy() {},
        prompt: async (messages: any[], options: any) => {
          const prompt = messages
            .flatMap((m) => m.content.map((c: any) => c.value))
            .join("");
          const data = JSON.parse(prompt.split("\nDATA=")[1]);
          if (prompt.startsWith("Describe this document")) {
            w.__localCalls.summary++;
            const cv = data.name === "cv.txt";
            return JSON.stringify({
              summary: cv
                ? "A personal CV."
                : data.name === "notes.txt"
                  ? "Lecture notes on probability for a class."
                  : "An academic paper on graph theory.",
              topics: ["test"],
              sensitive: cv,
              sensitiveReason: cv ? "personal details" : "",
            });
          }
          w.__localCalls.place++;
          const allowed = options.responseConstraint.properties.categoryId.enum;
          return JSON.stringify({ categoryId: allowed[1], confidence: "low" });
        },
      }),
    };
  });
  const cloudBodies: string[] = [];
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:5190/")) return route.continue();
    if (url.includes("exchangeDebugToken"))
      return route.fulfill({
        json: { token: "isolated-test-token", ttl: "3600s" },
      });
    if (url.includes(":generateContent")) {
      const body = route.request().postData() ?? "";
      cloudBodies.push(body);
      const sent = JSON.parse(
        JSON.parse(body).contents[0].parts[0].text.split("\nDATA=")[1],
      );
      const ref = (name: string) =>
        sent.files.find((f: any) => f.name === name)?.ref ?? "none";
      if (sent.files.some((f: any) => f.name === "later.md"))
        return route.fulfill({
          json: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      text: JSON.stringify({
                        newCollections: [],
                        placements: [
                          {
                            file: ref("later.md"),
                            collection: "c1",
                            confidence: "high",
                          },
                        ],
                        questions: [],
                      }),
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          },
        });
      const plan = {
        newCollections: [
          { key: "n1", name: "Coursework", description: "Class material" },
          { key: "n2", name: "Research", description: "Own reading" },
        ],
        placements: [
          { file: ref("notes.txt"), collection: "n1", confidence: "high" },
          { file: ref("paper.md"), collection: "n2", confidence: "low" },
        ],
        questions: [
          {
            question: "Is this paper for a class or your own research?",
            files: [ref("paper.md")],
            options: [
              {
                label: "For a class",
                collection: "n1",
                preference: "Graph theory papers are for class",
              },
              {
                label: "My own research",
                collection: "n2",
                preference: "Graph theory papers are own research",
              },
            ],
          },
        ],
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
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  await page.locator("#library-files").setInputFiles([
    {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("BODYMARK-ONE lecture notes on probability"),
    },
    {
      name: "paper.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("BODYMARK-TWO a paper on graph theory"),
    },
    {
      name: "cv.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("BODYMARK-THREE Jane Doe, jane@example.com"),
    },
  ]);

  // One-time consent, inline (no dialog). Nothing is sent before the click.
  const panel = page.locator("#organize-panel");
  await expect(panel).toContainText("Sort these files with cloud help?");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(cloudBodies).toHaveLength(0);
  await panel.getByRole("button", { name: "Allow cloud sorting" }).click();

  // Filed immediately; the question appears inline.
  await expect(panel).toContainText(
    "Sorted 3 files and made 2 new collections",
  );
  expect(cloudBodies).toHaveLength(1);
  expect(cloudBodies[0]).not.toContain("BODYMARK");
  expect(cloudBodies[0]).not.toContain("cv.txt");
  expect(cloudBodies[0]).not.toContain("jane@example.com");
  const card = (name: string) =>
    page
      .getByRole("combobox", { name: `Collection for ${name}`, exact: true })
      .locator("option:checked");
  await page.locator("#all-filter").click();
  await expect(card("notes.txt")).toHaveText("Coursework");
  await expect(card("paper.md")).toHaveText("Research");
  // The CV never left the device; the device model placed it.
  await expect(card("cv.txt")).toHaveText("Coursework");
  const calls = await page.evaluate(() => (window as any).__localCalls);
  expect(calls.summary).toBe(3);
  expect(calls.place).toBe(1);

  // Answer the inline question: the paper moves, and the answer is remembered.
  await expect(panel).toContainText(
    "Is this paper for a class or your own research?",
  );
  await panel.getByRole("button", { name: "Coursework", exact: true }).click();
  await expect(card("paper.md")).toHaveText("Coursework");
  await expect(page.locator("#workspace-message")).toContainText(
    "I'll remember this",
  );
  await expect(panel).not.toContainText("Is this paper");

  // Next import: the preference travels with the plan request, no consent asked again.
  await page.locator("#library-files").setInputFiles([
    {
      name: "later.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("BODYMARK-FOUR more lecture notes"),
    },
  ]);
  await expect(panel).toContainText("Sorted 1 file.");
  expect(cloudBodies).toHaveLength(2);
  expect(cloudBodies[1]).toContain("Graph theory papers are for class");
  await expect(card("later.md")).toHaveText("Coursework");

  // Undo reverses that whole sort run.
  await page.locator("#undo-workspace").click();
  await expect(card("later.md")).not.toHaveText("Coursework");
  await expect(card("notes.txt")).toHaveText("Coursework");
});
