import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const sslEnabled = env.SSL_ENABLED === "true";
  const httpsOptions = sslEnabled
    ? {
        key: fs.readFileSync(path.resolve(env.SSL_KEY_PATH ?? "ssl/key.pem")),
        cert: fs.readFileSync(
          path.resolve(env.SSL_CERT_PATH ?? "ssl/cert.pem"),
        ),
      }
    : undefined;

  return {
    root: "src/client",
    resolve: {
      alias: {
        "~": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    plugins: [react()],
    server: {
      https: httpsOptions,
      proxy: {
        "/api": {
          target: sslEnabled
            ? "https://localhost:3001"
            : "http://localhost:3001",
          secure: false, // allow self-signed cert on the backend
        },
      },
    },
  };
});
