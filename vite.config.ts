import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  root: "src/client",
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/auth": "http://localhost:3001",
      "/user": "http://localhost:3001",
      "/session": "http://localhost:3001",
      "/health": "http://localhost:3001",
      "/schedule": "http://localhost:3001",
    },
  },
});
