import { test, expect } from "@playwright/test";

// Feature 5: device-written display titles. Model double only.
test("titles show on cards and in the file view, are searchable, and can be switched off", async ({
  page,
}) => {
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
            summary: `About ${data.name}.`,
            topics: [],
            sensitive: false,
            sensitiveReason: "",
            dates: [],
            title:
              data.name === "notes.txt"
                ? "To-do list: printer ink and tutor email"
                : "",
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
    ["notes.txt", "plain.md"].map((name) => ({
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

  // Card: title first, original name underneath; spoken name includes both.
  const titled = page.getByRole("button", {
    name: "Open To-do list: printer ink and tutor email (notes.txt)",
  });
  await expect(titled).toContainText("To-do list: printer ink and tutor email");
  await expect(titled).toContainText("notes.txt");
  // A file without a title keeps its name.
  await expect(
    page.getByRole("button", { name: "Open plain.md", exact: true }),
  ).toBeVisible();

  // File view shows both.
  await titled.click();
  await expect(page.locator("#document-detail h2")).toHaveText(
    "To-do list: printer ink and tutor email",
  );
  await expect(page.locator("#document-detail")).toContainText(
    "File: notes.txt",
  );

  // Search matches the title.
  await page.locator("#document-search").fill("printer ink");
  await expect(page.locator(".document-row")).toHaveCount(1);
  await page.locator("#document-search").fill("");

  // Settings switch shows original file names again.
  await page.locator("#open-settings").click();
  await page.locator("#show-file-names").check();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open notes.txt", exact: true }),
  ).toBeVisible();
  expect(outbound).toEqual([]);
});
