import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 3000, host: "127.0.0.1" },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  build: {
    // three.js 单独成块：首屏不必下载 3D 引擎
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"] },
      },
    },
  },
})
