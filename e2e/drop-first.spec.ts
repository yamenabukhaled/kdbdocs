import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function simulatedDevice(page: Page, invalid = false) {
  await page.addInitScript(
    ({ invalid }) => {
      const w = window as unknown as {
        LanguageModel: unknown;
        __prompts: string[];
      };
      w.__prompts = [];
      w.LanguageModel = {
        availability: async () => "available",
        create: async () => ({
          destroy() {},
          async prompt(messages: { content: { value: string }[] }[]) {
            const prompt = messages
              .flatMap((m) => m.content.map((p) => p.value))
              .join("");
            w.__prompts.push(prompt);
            if (prompt.includes("\nQUERY=")) {
              await new Promise((resolve) => setTimeout(resolve, 350));
              return JSON.stringify({
                terms: ["lithium", "low temperatures", "capacity"],
              });
            }
            const data = JSON.parse(prompt.split("\nDATA=")[1]);
            if (data.documents)
              return JSON.stringify({
                categories: [
                  {
                    name: "Reading",
                    description:
                      "Technical reading; ask whether assigned or independent.",
                    documentId: data.documents.find((d: { text: string }) =>
                      d.text.includes("reading"),
                    ).id,
                    quote: invalid ? "invented evidence" : "reading",
                  },
                  {
                    name: "Finance",
                    description: "Invoices and bookkeeping records.",
                    documentId: data.documents.find((d: { text: string }) =>
                      d.text.includes("invoice"),
                    ).id,
                    quote: "invoice",
                  },
                ],
              });
            const finance = data.excerpts[0].text.includes("invoice");
            return JSON.stringify({
              categoryId: data.categories.find(
                (c: { name: string }) =>
                  c.name === (finance ? "Finance" : "Reading"),
              ).id,
              reason: finance
                ? "An invoice."
                : "Reading topic identified; intended use is unknown.",
              quote: data.excerpts[0].text.slice(0, 30),
              needsIntent: !finance,
            });
          },
        }),
      };
    },
    { invalid },
  );
}
async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
}
async function drop(page: Page) {
  await page.locator("#all-filter").click();
  const transfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(
      new File(["assigned reading about circuits"], "a.txt", {
        type: "text/plain",
      }),
    );
    dt.items.add(
      new File(["independent reading about circuits"], "b.md", {
        type: "text/markdown",
      }),
    );
    dt.items.add(
      new File(["invoice for lab equipment"], "c.txt", { type: "text/plain" }),
    );
    return dt;
  });
  await page
    .locator("#drop-zone")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
}
test("progressively saved manual imports undo as one batch and leave no searchable deleted text", async ({
  page,
}) => {
  await open(page);
  await page.locator("#open-upload").click();
  await page.locator("#auto-organize").uncheck();
  await page.locator("#close-upload").click();
  await page.locator("#all-filter").click();
  await page.locator("#library-files").setInputFiles([
    {
      name: "one.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("UNIQUE_BATCH_CONTENT"),
    },
    {
      name: "two.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("UNIQUE_BATCH_CONTENT second"),
    },
  ]);
  await expect(page.locator("#workspace-message")).toContainText(
    "2 documents saved locally",
  );
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#document-search").fill("UNIQUE_BATCH_CONTENT");
  await expect(page.locator("#search-status")).toContainText(
    "2 matching documents",
  );
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#undo-workspace").click();
  await expect(page.locator("#search-status")).toContainText(
    "0 matching documents",
  );
  await expect(page.locator(".document-row")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#document-count")).toHaveText("0");
});

test("content phrases and combined filters find opaque filenames", async ({
  page,
}) => {
  await simulatedDevice(page);
  await open(page);
  await page.locator("#open-upload").click();
  await page.locator("#auto-organize").uncheck();
  await page.locator("#close-upload").click();
  await page.locator("#all-filter").click();
  await page.locator("#library-files").setInputFiles([
    {
      name: "scan-482.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Lithium cells suffer reduced capacity at low temperatures.",
      ),
    },
    {
      name: "invoice.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("invoice for office supplies"),
    },
  ]);
  await expect(page.locator("#workspace-message")).toContainText(
    "2 documents saved locally",
  );
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#document-search").fill('"reduced capacity"');
  await expect(page.locator(".document-row")).toHaveCount(1);
  await expect(page.locator(".document-preview").first()).toContainText(
    "low temperatures",
  );
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#browse-filters").evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  await page.locator("#type-filter").selectOption("md");
  await expect(page.locator(".document-row")).toHaveCount(0);
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#browse-filters").evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  await page.locator("#type-filter").selectOption("all");
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#document-search").fill("office supplies");
  await expect(page.locator(".document-row")).toHaveCount(1);
  await expect(page.locator(".document-row")).toContainText("invoice.md");
  await expect(page.locator("#search-status")).not.toContainText(
    "Related terms",
  );
  await page.reload();
  if (await page.locator("body.home-view").count())
    await page.locator("#all-filter").click();
  await page.locator("#document-search").fill("low temperatures");
  await expect(page.locator(".document-row")).toHaveCount(1);
});
