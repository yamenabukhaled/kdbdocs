// Organize flow, inline: files are summarized on the device, sorted in small
// batches by the cloud model (after a one-time yes), and filed immediately.
// Questions appear as inline cards; answers move files and become preferences.
import {
  answerQuestion,
  applyPlan,
  defaultChoices,
  finalizePlan,
  hasFreshSummary,
  localPlacePrompt,
  pendingFromPlan,
  planPrompt,
  preparePlan,
  screenText,
  summaryPrompt,
  validateLocalPlace,
  validatePlan,
  validateSummary,
} from "./plan";
import { excerptRanges } from "./analysis";
import { inferCloudPlan, inferLocal, initializeLocal } from "./firebase";
import type {
  Body,
  DocumentMeta,
  Library,
  OrganizePlan,
  PlanPlacement,
} from "./workspace";

export type OrganizerContext = {
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  library: () => Library;
  /** Fresh read from storage, so changes made in other tabs are seen. */
  readStored: () => Promise<Library>;
  mutate: (
    transform: (current: Library) => Library,
    message: string,
    bodies?: Body[],
    remember?: boolean,
  ) => Promise<boolean>;
  readBody: (id: string) => Promise<Body | undefined>;
  say: (message: string, error?: boolean) => void;
  /** Claims the shared "running" lock; returns an AbortController or null if busy. */
  begin: () => AbortController | null;
  end: () => void;
  stopped: () => boolean;
  useCollection: (id: string) => void;
  /** Re-run the workspace's control-state pass (which calls protect()). */
  refresh: () => void;
};

const BATCH = 8;
const SUMMARY_TIMEOUT = 90_000;
const PLACE_TIMEOUT = 60_000;
const BUSY = /(503|429|500)|Deadline expired|overloaded/i;
const excerptOf = (body: Body) =>
  excerptRanges(body)
    .map((r) => body.text.slice(r.start, r.end))
    .join("\n…\n")
    .slice(0, 3000);
const folderOf = (path?: string) =>
  path ? path.split("/").slice(0, -1).join("/") : "";
const unfiled = (library: Library, ids?: string[]) =>
  library.documents.filter(
    (d) =>
      !d.categoryId &&
      d.characters > 0 &&
      ["ready", "partial"].includes(d.status) &&
      (!ids || ids.includes(d.id)),
  );
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class TimeoutError extends Error {}
/**
 * Per-file time limit. The run-wide signal is still what the model sees: the
 * Firebase wrapper rebuilds its model object whenever the signal changes. A
 * late result is ignored.
 */
function withTimeout<T>(pending: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    pending,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new TimeoutError("This file took too long.")),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createOrganizer(ctx: OrganizerContext) {
  const { el, say } = ctx;
  const node = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
    className?: string,
  ) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (className) n.className = className;
    return n;
  };
  let progress = "";
  let lastResult = "";
  let resolveConsent: ((allowed: boolean) => void) | null = null;
  let deviceOnlyThisRun = false;

  // ---------- Device: screen + summarize ----------

  async function summarize(document: DocumentMeta, signal: AbortSignal) {
    const body = await ctx.readBody(document.id);
    if (!body) return false;
    const hits = screenText(body.text, document.name, document.relativePath);
    try {
      const response = await withTimeout(
        inferLocal(
          summaryPrompt(
            document.name,
            folderOf(document.relativePath),
            excerptOf(body),
          ),
          signal,
          "summary",
        ),
        SUMMARY_TIMEOUT,
      );
      const summary = validateSummary(
        response.text,
        response.source,
        document.contentHash,
        hits,
      );
      await ctx.mutate(
        (current) => ({
          ...current,
          documents: current.documents.map((d) =>
            d.id === document.id && d.contentHash === summary.contentHash
              ? {
                  ...d,
                  summary,
                  // Sensitive files are protected from now on, not just for this run.
                  localOnly: d.localOnly || summary.sensitive,
                  analysisError: undefined,
                }
              : d,
          ),
        }),
        "",
        [],
        false,
      );
      return true;
    } catch (error) {
      if (signal.aborted) throw error;
      await ctx.mutate(
        (current) => ({
          ...current,
          documents: current.documents.map((d) =>
            d.id === document.id
              ? {
                  ...d,
                  analysisError:
                    error instanceof Error
                      ? error.message
                      : "On-device summary failed.",
                }
              : d,
          ),
        }),
        "",
        [],
        false,
      );
      return false;
    }
  }

  // ---------- Consent (one time, inline) ----------

  function waitForConsent(signal: AbortSignal): Promise<boolean> {
    const library = ctx.library();
    if (library.cloudSorting) return Promise.resolve(!library.globalLocalOnly);
    // Asked once; the workspace Local only switch afterwards means device only.
    if (deviceOnlyThisRun) return Promise.resolve(false);
    render();
    return new Promise((resolve) => {
      resolveConsent = resolve;
      signal.addEventListener(
        "abort",
        () => {
          resolveConsent = null;
          resolve(false);
          render();
        },
        { once: true },
      );
      render();
    });
  }

  async function allowCloud() {
    const saved = await ctx.mutate(
      (current) => ({
        ...current,
        cloudSorting: true,
        globalLocalOnly: false,
      }),
      "Cloud sorting is on. Files flagged as personal stay on this device. You can turn it off in Settings.",
      [],
      false,
    );
    if (saved && resolveConsent) {
      resolveConsent(true);
      resolveConsent = null;
    }
    render();
  }

  function keepLocal() {
    deviceOnlyThisRun = true;
    resolveConsent?.(false);
    resolveConsent = null;
    render();
  }

  // ---------- Placement ----------

  async function placeLocally(
    library: Library,
    plan: OrganizePlan,
    ids: string[],
    signal: AbortSignal,
  ): Promise<PlanPlacement[]> {
    const options = plan.collections.map((c) => ({
      id: c.key,
      name: c.name,
      description: c.description,
    }));
    const placements: PlanPlacement[] = [];
    const documents = ids
      .map((id) => library.documents.find((d) => d.id === id))
      .filter((d): d is DocumentMeta => !!d && hasFreshSummary(d));
    if (!options.length || !documents.length) return placements;
    await initializeLocal(
      () => undefined,
      signal,
      "place",
      options.map((o) => o.id),
    );
    for (const document of documents) {
      if (signal.aborted) break;
      try {
        const response = await withTimeout(
          inferLocal(
            localPlacePrompt(document, options),
            signal,
            "place",
            options.map((o) => o.id),
          ),
          PLACE_TIMEOUT,
        );
        placements.push({
          documentId: document.id,
          ...validateLocalPlace(
            response.text,
            response.source,
            options.map((o) => o.id),
          ),
          route: "local",
        });
      } catch {
        if (signal.aborted) break;
      }
    }
    return placements;
  }

  /** One cloud plan call, retried once after a short wait if the service is busy. */
  async function cloudPlan(ids: string[], signal: AbortSignal) {
    const prepared = preparePlan(ctx.library(), ids);
    if (!prepared.payload.files.length) return { prepared, plan: null };
    const snapshot = JSON.stringify(prepared.payload);
    const authorized = async () => {
      if (signal.aborted) return false;
      const fresh = await ctx.readStored();
      if (!fresh.cloudSorting || fresh.globalLocalOnly) return false;
      // What would be sent now must equal what was prepared.
      return JSON.stringify(preparePlan(fresh, ids).payload) === snapshot;
    };
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await inferCloudPlan(
          planPrompt(prepared.payload),
          signal,
          authorized,
        );
        if (response.source !== "in_cloud")
          throw new Error("The plan did not come from the cloud route.");
        return {
          prepared,
          plan: validatePlan(response.text, prepared, ctx.library()),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (attempt === 0 && BUSY.test(message) && !signal.aborted) {
          progress = "The cloud model is busy. Trying again in a few seconds…";
          render();
          await sleep(5000);
          continue;
        }
        throw error;
      }
    }
  }

  /** Plan and file one batch immediately. */
  async function sortBatch(ids: string[], signal: AbortSignal) {
    const allowed = await waitForConsent(signal);
    if (signal.aborted) return { filed: 0, created: [] as string[] };
    let plan: OrganizePlan | null = null;
    let kept = ids;
    if (allowed) {
      try {
        const result = await cloudPlan(ids, signal);
        plan = result.plan;
        kept = result.prepared.kept.map((k) => k.id);
      } catch (error) {
        if (signal.aborted) throw error;
        const message = error instanceof Error ? error.message : "";
        say(
          `${BUSY.test(message) ? "The cloud model was busy" : `Cloud sorting failed (${message.slice(0, 160)})`}. These files were sorted on this device instead.`,
          true,
        );
        plan = null;
        kept = ids;
      }
    }
    const library = ctx.library();
    if (!plan)
      plan = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        collections: library.categories
          .filter((c) => !c.proposalSource)
          .map((c) => ({
            key: `c:${c.id}`,
            name: c.name,
            description: c.description,
            existingId: c.id,
          })),
        placements: [],
        questions: [],
      };
    if (kept.length)
      plan.placements.push(
        ...(await placeLocally(library, plan, kept, signal)),
      );
    plan = finalizePlan(plan);
    if (signal.aborted || !plan.placements.some((p) => p.collectionKey))
      return { filed: 0, created: [] };
    let filed = 0;
    let created: string[] = [];
    const finished = plan;
    const choices = defaultChoices(finished);
    for (const [id, key] of choices) if (!key) choices.delete(id);
    await ctx.mutate(
      (current) => {
        // Skip files the person filed by hand while this batch was running.
        for (const id of [...choices.keys()])
          if (current.documents.find((d) => d.id === id)?.categoryId)
            choices.delete(id);
        const result = applyPlan(current, finished, choices, new Map(), true);
        filed = result.assigned;
        created = result.created;
        return {
          ...result.library,
          pendingQuestions: [
            ...(current.pendingQuestions ?? []),
            ...pendingFromPlan(finished, result.idForKey),
          ],
        };
      },
      "",
      [],
      false,
    );
    for (const id of new Set(
      [...choices.keys()]
        .map((id) => ctx.library().documents.find((d) => d.id === id))
        .map((d) => d?.categoryId)
        .filter((id): id is string => !!id),
    ))
      ctx.useCollection(id);
    return { filed, created };
  }

  // ---------- Run ----------

  /** Entry point: after import, or from the Organize button. */
  async function organize(ids?: string[], warm?: Promise<void>) {
    const controller = ctx.begin();
    if (!controller) return;
    const signal = controller.signal;
    deviceOnlyThisRun = false;
    lastResult = "";
    let filed = 0;
    let failed = 0;
    const created = new Set<string>();
    let undoTaken = false;
    try {
      const documents = unfiled(ctx.library(), ids);
      if (!documents.length) {
        say(
          "Nothing to sort: every file with text is already in a collection.",
        );
        return;
      }
      progress =
        "Preparing the on-device model. The first run can take a few minutes.";
      render();
      try {
        await (warm ?? initializeLocal(() => undefined, signal, "summary"));
      } catch (error) {
        say(
          `The on-device model is unavailable, so files could not be read for sorting. They stay saved; you can file them by hand. ${error instanceof Error ? error.message : ""}`,
          true,
        );
        return;
      }
      for (let start = 0; start < documents.length; start += BATCH) {
        if (ctx.stopped() || signal.aborted) break;
        const batch = documents.slice(start, start + BATCH);
        for (const [i, document] of batch.entries()) {
          if (ctx.stopped() || signal.aborted) break;
          const current = ctx
            .library()
            .documents.find((d) => d.id === document.id);
          if (!current || current.categoryId || hasFreshSummary(current))
            continue;
          progress = `Reading on this device ${start + i + 1} of ${documents.length}: ${document.name}`;
          render();
          if (!(await summarize(current, signal))) failed++;
        }
        if (ctx.stopped() || signal.aborted) break;
        progress = `Sorting ${start + 1}–${start + batch.length} of ${documents.length}…`;
        render();
        if (!undoTaken) {
          // One Undo point for the whole run: snapshot before the first filing.
          undoTaken = true;
          await ctx.mutate((current) => ({ ...current }), "", [], true);
        }
        const result = await sortBatch(
          batch.map((d) => d.id),
          signal,
        );
        filed += result.filed;
        for (const name of result.created) created.add(name);
      }
      const left = unfiled(
        ctx.library(),
        documents.map((d) => d.id),
      ).length;
      lastResult =
        `Sorted ${plural(filed, "file")}` +
        (created.size
          ? ` and made ${plural(created.size, "new collection")} (${[...created].join(", ")})`
          : "") +
        "." +
        (left ? ` ${plural(left, "file")} left unfiled.` : "") +
        (failed
          ? ` ${plural(failed, "file")} could not be read on this device.`
          : "") +
        (ctx.stopped() ? " Stopped early." : "");
    } catch (error) {
      if (!signal.aborted)
        say(
          `Sorting stopped: ${error instanceof Error ? error.message : "unknown error"}. Files filed so far are kept.`,
          true,
        );
    } finally {
      progress = "";
      resolveConsent?.(false);
      resolveConsent = null;
      ctx.end();
      render();
    }
  }

  // ---------- Inline panel ----------

  async function answer(questionId: string, optionIndex: number | null) {
    let moved = 0;
    const saved = await ctx.mutate(
      (current) => {
        const result = answerQuestion(current, questionId, optionIndex);
        moved = result.moved;
        return result.library;
      },
      "",
      [],
      false,
    );
    if (saved && optionIndex !== null)
      say(
        moved
          ? `Moved ${plural(moved, "file")}. I'll remember this for next time.`
          : "Kept where it was. I'll remember this for next time.",
      );
  }

  function render() {
    const panel = el("organize-panel");
    panel.replaceChildren();
    const library = ctx.library();
    if (resolveConsent) {
      const card = node("div", undefined, "ask-card");
      card.append(
        node("p", "Sort these files with cloud help?", "ask-title"),
        node(
          "p",
          `Your device writes a short summary of each file. Only those summaries, file names and folder names are sent to a Gemini model in the cloud to choose collections. Document text is never sent, and files that look personal stay on this device. On the free tier, Google may use what's sent to improve its products. You'll only be asked once; turn it off any time in Settings.`,
          "note",
        ),
      );
      const actions = node("div", undefined, "ask-options");
      const allow = node("button", "Allow cloud sorting");
      allow.type = "button";
      allow.onclick = () => void allowCloud();
      const local = node(
        "button",
        "Keep everything on this device",
        "secondary",
      );
      local.type = "button";
      local.onclick = keepLocal;
      actions.append(allow, local);
      card.append(actions);
      panel.append(card);
    }
    if (progress) {
      const row = node("div", undefined, "organize-progress");
      row.append(node("span", progress));
      panel.append(row);
    } else if (lastResult) {
      const row = node("div", undefined, "organize-progress");
      row.append(node("span", lastResult));
      const undo = node("button", "Undo", "quiet-button");
      undo.type = "button";
      undo.onclick = () => {
        lastResult = "";
        el<HTMLButtonElement>("undo-workspace").click();
      };
      const dismiss = node("button", "Dismiss", "quiet-button");
      dismiss.type = "button";
      dismiss.onclick = () => {
        lastResult = "";
        render();
      };
      row.append(undo, dismiss);
      panel.append(row);
    }
    const docs = new Map(library.documents.map((d) => [d.id, d]));
    const names = new Map(library.categories.map((c) => [c.id, c.name]));
    for (const question of library.pendingQuestions ?? []) {
      const files = question.documentIds
        .map((id) => docs.get(id))
        .filter((d): d is DocumentMeta => !!d);
      if (!files.length) continue;
      const card = node("div", undefined, "ask-card");
      card.append(node("p", question.question, "ask-title"));
      card.append(
        node(
          "p",
          files
            .map(
              (d) =>
                `${d.name} (now in ${d.categoryId ? (names.get(d.categoryId) ?? "a collection") : "Unfiled"})`,
            )
            .join(", "),
          "note",
        ),
      );
      const options = node("div", undefined, "ask-options");
      question.options.forEach((option, index) => {
        const button = node(
          "button",
          option.collectionId
            ? (names.get(option.collectionId) ?? option.label)
            : (option.newCollection?.name ?? "Leave unfiled"),
          "secondary",
        );
        button.title = option.label;
        button.type = "button";
        button.disabled = !ready();
        button.onclick = () => void answer(question.id, index);
        options.append(button);
      });
      const skip = node("button", "Skip", "quiet-button");
      skip.type = "button";
      skip.onclick = () => void answer(question.id, null);
      options.append(skip);
      card.append(options);
      panel.append(card);
    }
    panel.hidden = !panel.childElementCount;
  }
  const ready = () => true;

  /**
   * Called from the workspace's protectControls(), which resets every control's
   * disabled state; re-apply this flow's own rules on top.
   */
  function protect(busy: boolean) {
    const button = el<HTMLButtonElement>("organize-button");
    const count = unfiled(ctx.library()).length;
    button.hidden = !count;
    button.textContent = `Sort unfiled (${count})`;
    button.disabled ||= busy;
  }
  el("organize-button").onclick = () => void organize();

  return { organize, protect, render };
}
