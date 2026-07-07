import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "node",
    setupFiles: [
      "./src/server/bootstrap/logger-global.ts",
      "./tests/setup.ts",
      "./tests/client/setup.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text"],
    },
  },
});
