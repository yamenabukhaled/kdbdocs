import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

test("30/100/500 document libraries load metadata lazily and assignment writes no text bodies", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __bodyReads: number; __writes: string[] };
    w.__bodyReads = 0;
    w.__writes = [];
    const get = IDBObjectStore.prototype.get;
    const getAll = IDBObjectStore.prototype.getAll;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === "bodies") w.__bodyReads++;
      return get.apply(this, args);
    };
    IDBObjectStore.prototype.getAll = function (...args) {
      if (this.name === "bodies") w.__bodyReads++;
      return getAll.apply(this, args);
    };
    IDBObjectStore.prototype.put = function (...args) {
      w.__writes.push(this.name);
      return put.apply(this, args);
    };
  });
  await page.goto("/");
  await expect(page.locator("#workspace-message")).toContainText(
    "Local workspace ready",
  );
  const results: unknown[] = [];
  for (const count of [30, 100, 500]) {
    await page.evaluate(async (count) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("document-assistant-local-v1", 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = reject;
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          ["meta", "documents", "bodies", "events", "rules", "jobs", "undo"],
          "readwrite",
        );
        for (const name of [
          "documents",
          "bodies",
          "events",
          "rules",
          "jobs",
          "undo",
        ])
          transaction.objectStore(name).clear();
        transaction.objectStore("meta").put(
          {
            revision: 0,
            globalLocalOnly: true,
            categories: [
              {
                id: "c",
                name: "Coursework",
                description: "Assigned reading",
                examples: "",
                localOnly: true,
              },
            ],
          },
          "current",
        );
        for (let index = 0; index < count; index++) {
          const id = `doc-${String(index).padStart(3, "0")}`;
          const text =
            "Synthetic assigned reading for storage testing. ".repeat(200);
          transaction.objectStore("documents").put(
            {
              id,
              name: `${id}.txt`,
              size: text.length,
              importedAt: "2026-11-12",
              categoryId: null,
              localOnly: true,
              characters: text.length,
              contentHash: id,
              status: "ready",
              coverage: { truncated: false, note: "Synthetic test" },
            },
            id,
          );
          transaction.objectStore("bodies").put(
            {
              id,
              text,
              chunks: [{ start: 0, end: text.length }],
              parserVersion: "test",
            },
            id,
          );
        }
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onabort = reject;
      });
    }, count);
    await page.goto("/");
    await expect(page.locator("#workspace-message")).toContainText(
      "Local workspace ready",
    );
    expect(
      await page.evaluate(
        () => (window as unknown as { __bodyReads: number }).__bodyReads,
      ),
    ).toBe(0);
    await page.locator("#all-filter").click();
    await expect(page.locator(".document-row")).toHaveCount(25);
    await page
      .getByRole("button", { name: "Open doc-000.txt", exact: true })
      .click();
    await expect(page.locator("#document-detail pre")).toContainText(
      "Synthetic assigned reading",
    );
    await page.evaluate(() => {
      (window as unknown as { __writes: string[] }).__writes = [];
    });
    const start = Date.now();
    await page
      .getByRole("combobox", { name: "Collection of doc-000.txt", exact: true })
      .selectOption("c");
    await expect(page.locator("#workspace-message")).toContainText(
      "Decision saved",
    );
    const actionMs = Date.now() - start;
    expect(
      await page.evaluate(() =>
        (window as unknown as { __writes: string[] }).__writes.includes(
          "bodies",
        ),
      ),
    ).toBe(false);
    await page.locator("#open-settings").click();
    const measurement = await page.locator("#storage-info").textContent();
    results.push({
      count,
      textCharactersPerDocument: 9400,
      uiAssignmentRoundTripMs: actionMs,
      metadataMeasurement: measurement,
      bodyReadsOnStartup: 0,
      bodyWritesOnAssignment: 0,
    });
    await page.getByRole("button", { name: "Close settings" }).click();
    const searchStart = Date.now();
    if (await page.locator("body.home-view").count())
      await page.locator("#all-filter").click();
    await page.locator("#document-search").fill("Synthetic assigned reading");
    await expect(page.locator("#search-status")).toContainText(
      `${count} matching documents`,
    );
    const firstSearchMs = Date.now() - searchStart;
    const readsAfterIndex = await page.evaluate(
      () => (window as unknown as { __bodyReads: number }).__bodyReads,
    );
    const warmStart = Date.now();
    if (await page.locator("body.home-view").count())
      await page.locator("#all-filter").click();
    await page.locator("#document-search").fill("assigned reading");
    await expect(page.locator("#search-status")).toContainText(
      `${count} matching documents`,
    );
    expect(
      await page.evaluate(
        () => (window as unknown as { __bodyReads: number }).__bodyReads,
      ),
    ).toBe(readsAfterIndex);
    Object.assign(results[results.length - 1] as object, {
      firstContentSearchRoundTripMs: firstSearchMs,
      warmContentSearchRoundTripMs: Date.now() - warmStart,
      additionalBodyReadsOnWarmSearch: 0,
    });
  }
  await testInfo.attach("scale-observations.json", {
    body: JSON.stringify(
      {
        note: "Single observations on this device, synthetic corpus; not inference or comparative performance benchmarks.",
        results,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await mkdir("validation", { recursive: true });
  await writeFile(
    `validation/scale-${process.env.LIBRARY_TEST_PRODUCTION ? "production" : "development"}.json`,
    JSON.stringify(
      {
        note: "Single synthetic observations; no inference benchmark or before/after speedup claim.",
        results,
      },
      null,
      2,
    ),
  );
});
