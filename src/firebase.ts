import { nativeSchema, constrainReview } from "./model-schema";
import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  getToken,
} from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  Schema,
} from "firebase/ai";
import {
  fetchAndActivate,
  getRemoteConfig,
  getValue,
} from "firebase/remote-config";

export const diagnosticPrompt =
  "Reply with one short sentence: a document organizer keeps files in collections.";
// Firebase web config comes from .env.local (see .env.example); nothing is hard-coded.
const env = (import.meta as ImportMeta & { env: Record<string, string> }).env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
export const firebaseProjectId = config.projectId ?? "";
let app: ReturnType<typeof initializeApp> | undefined;
let cloudApp: ReturnType<typeof initializeApp> | undefined;
let check: ReturnType<typeof initializeAppCheck> | undefined;
function firebaseApp() {
  return (app ??= initializeApp(config));
}
function cloudFirebaseApp() {
  return (cloudApp ??= initializeApp(config, "document-assistant-cloud"));
}
type LocalTask = "summary" | "place" | "search" | "collection" | "ask";
const askSchema = Schema.object({
  properties: {
    answer: Schema.string({ maxLength: 800 }),
    found: Schema.boolean(),
  },
});
const summarySchema = Schema.object({
  properties: {
    summary: Schema.string({ maxLength: 240 }),
    topics: Schema.array({ maxItems: 5, items: Schema.string() }),
    sensitive: Schema.boolean(),
    sensitiveReason: Schema.string({ maxLength: 120 }),
    dates: Schema.array({
      maxItems: 3,
      items: Schema.object({
        properties: {
          what: Schema.string({ maxLength: 80 }),
          date: Schema.string(),
        },
      }),
    }),
  },
});
const placeSchema = Schema.object({
  properties: {
    categoryId: Schema.string(),
    confidence: Schema.enumString({ enum: ["high", "low"] }),
  },
});
const planSchema = Schema.object({
  properties: {
    newCollections: Schema.array({
      maxItems: 8,
      items: Schema.object({
        properties: {
          key: Schema.string(),
          name: Schema.string(),
          description: Schema.string(),
        },
      }),
    }),
    placements: Schema.array({
      items: Schema.object({
        properties: {
          file: Schema.string(),
          collection: Schema.string(),
          confidence: Schema.enumString({ enum: ["high", "low"] }),
        },
      }),
    }),
    questions: Schema.array({
      maxItems: 5,
      items: Schema.object({
        properties: {
          question: Schema.string(),
          files: Schema.array({ items: Schema.string() }),
          options: Schema.array({
            items: Schema.object({
              properties: {
                label: Schema.string(),
                collection: Schema.string(),
                preference: Schema.string(),
              },
            }),
          }),
        },
      }),
    }),
  },
});
/** Cloud model for batch planning. Check https://firebase.google.com/docs/ai-logic/models before changing. */
export const PLAN_MODEL = "gemini-3.5-flash-lite";
/**
 * The cloud model can be switched with the Remote Config parameter
 * `plan_model` (e.g. when a model is overloaded), without republishing.
 * Fetched only right before a consented cloud sort; falls back to PLAN_MODEL.
 */
let remoteConfig: ReturnType<typeof getRemoteConfig> | undefined;
export async function planModel(): Promise<string> {
  try {
    remoteConfig ??= getRemoteConfig(cloudFirebaseApp());
    remoteConfig.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
    remoteConfig.settings.fetchTimeoutMillis = 3000;
    remoteConfig.defaultConfig = { plan_model: PLAN_MODEL };
    await Promise.race([
      fetchAndActivate(remoteConfig),
      new Promise((resolve) => setTimeout(resolve, 3500)),
    ]);
    const value = getValue(remoteConfig, "plan_model").asString().trim();
    return /^gemini-[a-z0-9.-]+$/.test(value) ? value : PLAN_MODEL;
  } catch {
    return PLAN_MODEL;
  }
}
const collectionSchema = Schema.object({
  properties: {
    description: Schema.string({ maxLength: 120 }),
    quote: Schema.string({ maxLength: 80 }),
  },
});
const searchSchema = Schema.object({
  properties: { terms: Schema.array({ items: Schema.string() }) },
});
let modelConstraint = "";
let modelTask: LocalTask = "summary";
let localModel: ReturnType<typeof getGenerativeModel> | undefined;
let modelSignal: AbortSignal | undefined;
function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) {
      void pending.catch(() => undefined);
      cancel();
      return;
    }
    signal.addEventListener("abort", cancel, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
  });
}
function assertDeviceApi() {
  const api = (
    globalThis as unknown as {
      LanguageModel?: { availability?: unknown; create?: unknown };
    }
  ).LanguageModel;
  if (
    !isSecureContext ||
    typeof api?.availability !== "function" ||
    typeof api?.create !== "function"
  ) {
    throw new Error(
      "Chrome Prompt API is absent or this context is insecure. Local-only input is blocked before SDK dispatch; use manual review.",
    );
  }
}
function deviceModel(
  signal?: AbortSignal,
  task: LocalTask = "summary",
  allowedIds?: string[],
) {
  const constraint = JSON.stringify(allowedIds ?? []);
  // SDK 13.3.0's no-adapter branch calls cloud. Never rely on the mode flag alone.
  assertDeviceApi();
  if (
    (signal && signal !== modelSignal) ||
    task !== modelTask ||
    constraint !== modelConstraint
  ) {
    modelConstraint = constraint;
    localModel = undefined;
    if (signal) modelSignal = signal;
    modelTask = task;
  }
  return (localModel ??= getGenerativeModel(
    getAI(firebaseApp(), { backend: new GoogleAIBackend() }),
    {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        promptOptions: {
          responseConstraint:
            task === "summary"
              ? nativeSchema(summarySchema)
              : task === "place"
                ? constrainReview(placeSchema, allowedIds ?? [])
                : task === "ask"
                  ? nativeSchema(askSchema)
                  : task === "collection"
                    ? nativeSchema(collectionSchema)
                    : nativeSchema(searchSchema),
        },
        createOptions: {
          signal: modelSignal,
          expectedInputs: [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
        },
      },
    },
  ));
}
export async function initializeLocal(
  progress: (message: string) => void,
  signal?: AbortSignal,
  task: LocalTask = "summary",
  allowedIds?: string[],
) {
  await abortable(
    deviceModel(signal, task, allowedIds).initializeDeviceModel((value) =>
      progress(`Local model download: ${Math.round(value * 100)}%`),
    ),
    signal,
  );
}
export async function inferLocal(
  prompt: string,
  signal: AbortSignal,
  task: LocalTask = "summary",
  allowedIds?: string[],
) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const result = await abortable(
    deviceModel(signal, task, allowedIds).generateContent(prompt, { signal }),
    signal,
  );
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  return {
    text: result.response.text(),
    source: String(result.response.inferenceSource ?? ""),
  };
}
export async function inferCloudPlan(
  prompt: string,
  signal: AbortSignal,
  authorized: () => Promise<boolean>,
) {
  // Recheck consent before and after App Check, i.e. right before dispatch.
  if (!(await authorized()))
    throw new Error("Cloud planning is no longer authorized.");
  await configureCheck();
  const modelName = await planModel();
  if (signal.aborted || !(await authorized()))
    throw new Error("Cloud planning was cancelled. Nothing was sent.");
  const model = getGenerativeModel(
    getAI(cloudFirebaseApp(), { backend: new GoogleAIBackend() }),
    {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: planSchema,
          maxOutputTokens: 4096,
        },
      },
    },
  );
  const result = await model.generateContent(prompt, { signal });
  return {
    text: result.response.text(),
    source: String(result.response.inferenceSource ?? ""),
  };
}
export async function configureCheck() {
  const env = (
    import.meta as ImportMeta & { env: Record<string, string | boolean> }
  ).env;
  const debug =
    env.DEV &&
    env.VITE_APPCHECK_DEBUG === "true" &&
    ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!check) {
    if (!env.VITE_APPCHECK_SITE_KEY && !debug)
      throw new Error("Configure App Check in .env.local first; see README.");
    if (debug)
      (
        self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }
      ).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    check = initializeAppCheck(cloudFirebaseApp(), {
      provider: new ReCaptchaEnterpriseProvider(
        String(env.VITE_APPCHECK_SITE_KEY || "debug-only"),
      ),
      isTokenAutoRefreshEnabled: false,
    });
  }
  await getToken(check);
}
export async function runDiagnostic(
  route: "local" | "cloud",
  consent: () => boolean,
  progress: (message: string) => void,
) {
  if (route === "local") assertDeviceApi();
  if (route === "cloud" && !consent())
    throw new Error("Approve the displayed diagnostic prompt before sending.");
  if (route === "cloud") await configureCheck();
  // No imported documents, categories, filenames or personalization enter this function.
  const ai = getAI(route === "local" ? firebaseApp() : cloudFirebaseApp(), {
    backend: new GoogleAIBackend(),
  });
  const model = getGenerativeModel(ai, {
    mode:
      route === "local"
        ? InferenceMode.ONLY_ON_DEVICE
        : InferenceMode.ONLY_IN_CLOUD,
  });
  if (route === "local") {
    progress(
      "Initializing local model. A browser model download may be needed.",
    );
    await model.initializeDeviceModel((value) =>
      progress(`Model download: ${Math.round(value * 100)}%`),
    );
  } else {
    progress("Checking App Check authorization…");
    await configureCheck();
  }
  if (route === "cloud" && !consent())
    throw new Error("Diagnostic consent was revoked. The prompt was not sent.");
  progress("Running fixed diagnostic prompt…");
  const result = await model.generateContent(diagnosticPrompt);
  return {
    text: result.response.text(),
    source: result.response.inferenceSource ?? "SDK did not report a source",
  };
}
