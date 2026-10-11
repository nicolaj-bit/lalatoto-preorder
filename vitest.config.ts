// Egen konfiguration til tests, så Remix' Vite-plugin ikke starter med.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      { test: { name: "enhed", include: ["tests/unit/**/*.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          // Rigtige kald mod Shopify tager tid.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
