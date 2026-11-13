import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const shared = {
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
};

// Data-layer suites that also run against the desktop SQLite adapter.
const DATA_TESTS = ["tests/unit/local-data.test.ts", "tests/unit/local-pages.test.ts", "tests/unit/sqlite-adapter.test.ts"];

export default defineConfig({
  ...shared,
  test: {
    testTimeout: 20_000,
    projects: [
      {
        extends: true,
        test: {
          name: "indexeddb",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          exclude: ["tests/unit/sqlite-adapter.test.ts"],
          environment: "node",
          // A spec-compliant in-memory IndexedDB, so repository tests run the real Dexie adapter.
          setupFiles: ["fake-indexeddb/auto"],
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: "sqlite",
          include: DATA_TESTS,
          environment: "node",
          // The desktop storage adapter over Node's SQLite (same SQL as src-tauri/src/storage.rs).
          setupFiles: ["tests/setup/sqlite-engine.ts"],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
