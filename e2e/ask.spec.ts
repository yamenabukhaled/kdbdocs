import { test, expect } from "@playwright/test";

// Feature 2: ask about one file, answered on the device. Model double only.
test("asking a file answers on the device and sends nothing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__asked = [];
    w.LanguageModel = {
      availability: async () => "available",
      create: async () => ({
        destroy() {},
        prompt: async (messages: any[]) => {
          const prompt = messages
            .flatMap((m) => m.content.map((c: any) => c.value))
            .join("");
          if (!prompt.startsWith("Answer the question"))
            throw new Error("unexpected task");
          w.__asked.push(prompt);
          await new Promise((r) => setTimeout(r, 300));
          return JSON.stringify({ answer: "10% per day.", found: true });
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
  // Import without sorting, so only the ask feature talks to the model.
  await page
    .locator("#auto-organize")
    .evaluate((el: HTMLInputElement) => (el.checked = false));
  await page.locator("#library-files").setInputFiles([
    {
      name: "brief.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "Assignment 2. Late penalty: 10% per day. Due Friday of week 8.",
      ),
    },
  ]);
  await page.getByRole("button", { name: "Open brief.md" }).click();
  const box = page.locator(".ask-box");
  await box
    .getByRole("textbox", { name: "Question about brief.md" })
    .fill("What's the late penalty?");
  await box.getByRole("button", { name: "Ask" }).click();
  await expect(box).toContainText("Reading the file on this device");
  await expect(box.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(box).toContainText("10% per day.");
  await expect(box).toContainText("Answered on this device; nothing was sent.");
  const asked = await page.evaluate(() => (window as any).__asked as string[]);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("Late penalty: 10% per day");
  expect(asked[0]).toContain("What's the late penalty?");
  expect(outbound).toEqual([]);
});

test("without the on-device model, asking fails clearly with no cloud fallback", async ({
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
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText("ready");
  await page
    .locator("#auto-organize")
    .evaluate((el: HTMLInputElement) => (el.checked = false));
  await page.locator("#library-files").setInputFiles([
    {
      name: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A short note."),
    },
  ]);
  await page.getByRole("button", { name: "Open note.txt" }).click();
  const box = page.locator(".ask-box");
  await box
    .getByRole("textbox", { name: "Question about note.txt" })
    .fill("What is this?");
  await box.getByRole("button", { name: "Ask" }).click();
  await expect(box).toContainText("Nothing was sent to the cloud.");
  expect(outbound).toEqual([]);
});
