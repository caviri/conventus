import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// During local dev the API + WebSocket run on the FastAPI server (port 7860);
// Vite proxies to it so the frontend can be developed with hot reload.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:7860",
      "/ws": { target: "ws://localhost:7860", ws: true },
    },
  },
  build: {
    outDir: "dist",
  },
});
