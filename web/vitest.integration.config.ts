import { defineConfig } from "vitest/config";

/**
 * Vitest config for SLOW, network-dependent integration tests against Sui
 * mainnet. Not part of the default test run — invoke via the `test:integration`
 * package script.
 */
export default defineConfig({
  test: {
    include: ["__tests__/sui/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Mainnet rate-limits aggressive parallelism; one test file at a time is
    // enough today, so we don't need explicit pool/forks config — Vitest's
    // default is fine. If we add more test files and start hitting limits,
    // re-introduce poolOptions then with whatever the typed shape is at that
    // Vitest version.
    pool: "forks",
  },
});
