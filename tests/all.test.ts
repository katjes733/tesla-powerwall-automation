/**
 * This test file is designed to import all source files in the `src` directory
 * as workaround for bun's lack of inclusion of untested source files in coverage reports.
 */
import { describe, it, expect } from "bun:test";

import * as fs from "fs";
import * as pathModule from "path";

const srcDir = pathModule.join(process.cwd(), "src");

const fileMatchRegex = /^(?!.*\.test\.(js|ts)$).*?\.(js|ts)$/;

async function importAll(dir: string): Promise<void> {
  const promises: Promise<unknown>[] = [];
  for (const file of fs.readdirSync(dir)) {
    const filePath = pathModule.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      promises.push(importAll(filePath));
    } else if (fileMatchRegex.test(file)) {
      promises.push(
        import(filePath).catch((err) =>
          console.error(`Failed to import ${filePath}:`, err),
        ),
      );
    }
  }
  await Promise.all(promises);
}

describe("Load all source files for coverage", () => {
  it("should import all source files", async () => {
    await importAll(srcDir);
    expect(true).toBe(true);
  });
});
