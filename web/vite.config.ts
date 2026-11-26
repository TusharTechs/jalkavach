import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8036", "/brand": "http://127.0.0.1:8036" } },
  build: { chunkSizeWarningLimit: 4000 },
});
