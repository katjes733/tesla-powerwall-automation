import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    setupFiles: [
      "./src/server/bootstrap/logger-global.ts",
      "./tests/setup.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/client/**", "src/**/*.d.ts"],
      reporter: ["text"],
    },
  },
});
