import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5190",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1050 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js ${process.env.LIBRARY_TEST_PRODUCTION ? "preview" : ""} --host 127.0.0.1 --port 5190 --strictPort`,
    url: "http://127.0.0.1:5190",
    env: {
      VITE_APPCHECK_DEBUG: "true",
      VITE_FIREBASE_API_KEY: "test-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "test-project.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "test-project",
      VITE_FIREBASE_STORAGE_BUCKET: "test-project.firebasestorage.app",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
      VITE_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000",
    },
    reuseExistingServer: false,
  },
});
