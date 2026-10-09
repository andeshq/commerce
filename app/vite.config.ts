import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** App root without a trailing slash, used by the `@/` import alias. */
const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@/` → app root. Regex form keeps scoped packages like @heroui/react intact.
    alias: [{ find: /^@\//, replacement: `${root}/` }],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3000",
      "/media": "http://localhost:3000",
      "/rest": "http://localhost:3000",
    },
  },
});
