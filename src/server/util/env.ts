import { existsSync, readFileSync, writeFileSync } from "fs";

/**
 * Updates (or adds) an environment variable in your .env file,
 * while preserving empty lines and comments.
 *
 * @param filePath Path to your .env file.
 * @param key The environment variable key to update.
 * @param value The value to set.
 */
export function setEnvVar(key: string, value: string, filePath = ".env"): void {
  const fileContent = existsSync(filePath)
    ? readFileSync(filePath, "utf8")
    : "";

  const lines = fileContent.split(/\r?\n/);

  let keyFound = false;

  const updatedLines = lines.map((line) => {
    if (line.trim() === "" || line.trim().startsWith("#")) {
      return line;
    }

    const keyRegex = new RegExp(`^\\s*${key}\\s*=`);
    if (keyRegex.test(line)) {
      keyFound = true;
      return `${key}=${value}`;
    }

    return line;
  });

  if (!keyFound) {
    if (
      updatedLines.length > 0 &&
      updatedLines[updatedLines.length - 1] !== ""
    ) {
      updatedLines.push("");
    }
    updatedLines.push(`${key}=${value}`);
  }

  writeFileSync(filePath, updatedLines.join("\n"), "utf8");
}
