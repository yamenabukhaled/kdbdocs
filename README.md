# KDBDocs

**Drop a folder of mixed files and get them sorted into sensible collections, without uploading your documents.**

Downloads, coursework, work files, a CV, receipts and hobby projects tend to pile up in one place. Sorting them by hand is tedious, and the obvious AI fix of uploading everything to a cloud model isn't something you want to do with personal files.

KDBDocs splits the work between **Gemini Nano in Chrome** and **Gemini in the cloud**, both through **Firebase AI Logic**:

- **On your device (Gemini Nano, `ONLY_ON_DEVICE`):**
  - reads every file and writes a short summary with no names in it;
  - flags anything that looks personal;
  - sorts personal files itself, so they never leave the machine.
- **In the cloud (Gemini, `ONLY_IN_CLOUD`):**
  - sees only those summaries plus file and folder names, never document text;
  - designs a small set of collections named by purpose (Coursework, Research, Work, Personal…) rather than by subject;
  - places each file;
  - asks a question only when it can't tell your intent, for example "Is this paper for a class or your own research?".

Files are filed **immediately**. Questions appear as small inline cards with one button per collection. Each answer moves the file and is saved as a **preference** ("survey papers with no course link go in Research"), which is sent with every later sort, so the same question isn't asked twice. One **Undo** reverses a whole sort.

## Why the work is split this way

The split between device and cloud is decided by **privacy**, per task:

| Task                                                               | Where  | Why                                                                           |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------- |
| Read a file, summarize it, flag personal content                   | Device | The full text never leaves the machine                                        |
| Sort files flagged as personal                                     | Device | They're excluded from cloud requests entirely                                 |
| Design collections for the whole batch, place files, ask questions | Cloud  | Needs a stronger model that sees the batch as a whole; it only sees summaries |
| Describe a collection, expand a search query                       | Device | Uses document text or private search terms                                    |

Firebase's automatic hybrid modes (`PREFER_ON_DEVICE` / `PREFER_IN_CLOUD`) can fall back to the other route by themselves. KDBDocs picks the route explicitly per task instead, because an automatic fallback could send a private file's content to the cloud. The app also blocks cloud dispatch itself and does not rely on the mode flag alone.

**Privacy guards:**

- A deterministic screen runs before any AI. It looks for emails, phone numbers, card numbers (Luhn-checked), IBANs and keywords like "password" or "salary", and records only the _type_ of each hit.
- The on-device model's own "sensitive" flag is checked too. A missing flag counts as sensitive.
- The outgoing summary is scanned a second time before it is sent.
- Cloud sorting needs a **one-time explicit yes**. It can be turned off in Settings, and "Keep the entire workspace local only" blocks every cloud request.
- Right before each request, consent and the exact payload are re-read from storage, so a change made in another tab stops the request.
- App Check protects the cloud route.

**Firebase products used:**

- **AI Logic:** on-device and cloud inference.
- **App Check:** protects the cloud route.
- **Remote Config:** the `plan_model` parameter switches the cloud model without republishing. During development, `gemini-3.8-flash` timed out under load and `gemini-3.5-flash-lite` became the default. Remote Config is fetched only right before a consented cloud sort.

**Limits, stated plainly:**

- "No names in summaries" is an instruction to the model, not a guarantee. The screen catches common personal-data patterns, not everything.
- On the free tier, Google may use what's sent to improve its products. Don't sort genuinely confidential material with cloud help.

## Features

- **Import:** files or whole folders. PDF, Word (.docx), PowerPoint (.pptx), Markdown, plain text and data, and source code (R, Python, JS/TS, Java, C/C++, Go, Rust…). Text is extracted locally with ordinary parsers; code is never executed.
- **Batches:** sorting runs in groups of 8, so collections fill in while the import is still running. If the cloud model is busy, it retries once, then sorts that group on the device.
- **Browsing:** a Home view with recent collections, an All Collections grid, collection views, and search across the extracted text of every file (not just file names).
- **On-device extras (Gemini Nano; nothing is sent):**
  - **Summaries and topics:** every file shows what the device read, with topic chips you can click to filter.
  - **Ask about this file:** ask a question ("What's the late penalty?") and it's answered from the file's own text.
  - **Coming up:** deadlines, bills and trips found in your files, listed on Home.
  - **Find it for me:** describe a file you half-remember and the device picks the best matches.
  - **Clearer titles:** vague names like `notes.txt` get a descriptive title. Originals are never renamed.
- **Manual control:** a collection picker on every card, an editable collection list, and on-device collection descriptions.
- **Storage:** everything lives in the browser (IndexedDB). Originals are never moved, renamed or uploaded. Backup and restore to a local file.

## Run it

Requirements:

- Node 24+;
- desktop **Chrome** with the built-in model (Prompt API) available; see the [Firebase hybrid setup guide](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started);
- a Firebase project with **AI Logic** enabled (Gemini Developer API, no billing needed) and **App Check**.

From the app folder (the one containing `package.json`):

```bash
npm ci
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://127.0.0.1:5174
```

On Windows PowerShell, use `npm.cmd` instead of `npm`.

`.env.local`:

- the `VITE_FIREBASE_*` values come from Firebase console → Project settings → Your apps;
- for local development, set `VITE_APPCHECK_DEBUG=true`. Open http://127.0.0.1:5174/?diagnostics, expand **Connection diagnostics → Check App Check**, then register the debug token it prints in the Firebase console;
- for a hosted build, set `VITE_APPCHECK_SITE_KEY` to your reCAPTCHA Enterprise key instead.

**Try it:** upload the folder `pilot/demo-corpus/`. It holds 23 made-up files (coursework, independent reading, an internship, a hobby script, personal files, and a CV with fake contact details that should stay on the device). The expected result is in `pilot/demo-corpus-EXPECTED.md`.

## Tests

```bash
npm test             # unit tests, incl. the privacy boundary of what may be sent
npm run test:e2e     # browser tests (Playwright, Chrome)
npm run build
npm run format:check
```

The browser tests replace Gemini Nano and the cloud model with test doubles. They check routing, what is sent (no document text, no personal files), consent, cross-tab revocation, auto-filing, questions, preferences and Undo. They do **not** measure sorting quality. Sorting quality was checked by hand on the demo corpus with the real models; see `pilot/demo-corpus-EXPECTED.md`.

## Code map

| File                                                     | What it does                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/firebase.ts`                                        | Every Firebase AI Logic call: on-device tasks, the cloud plan call, App Check                                                        |
| `src/plan.ts`                                            | Privacy screen, summary prompt, the cloud payload (what may leave the device), plan validation, auto-filing, answers and preferences |
| `src/organize-ui.ts`                                     | The sorting run, the inline consent card and question cards                                                                          |
| `src/workspace-ui.ts`                                    | Library UI                                                                                                                           |
| `src/storage.ts`, `src/backup.ts`                        | IndexedDB storage, Undo, backup and restore                                                                                          |
| `src/parser.ts`, `src/office.ts`, `src/folder-import.ts` | Local text extraction and folder import                                                                                              |

## License

Apache License 2.0; see [LICENSE](LICENSE).
