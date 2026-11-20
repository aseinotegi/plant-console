import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs apart (plant-console on :8000); in production FastAPI
// serves this build itself, so the app always talks to /api on its own origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: process.env.API_URL ?? "http://localhost:8000", ws: true },
    },
  },
});
