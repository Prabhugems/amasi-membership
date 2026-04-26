import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "__tests__/**/*.{test,spec}.{ts,tsx}",
    ],
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
