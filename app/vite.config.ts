import { fileURLToPath } from "node:url";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** App root without a trailing slash, used by the `@/` import alias. */
const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  base: "/_/",
  plugins: [
    react(),
    tailwindcss(),
    // Compiles `project.inlang` into `paraglide/` (messages + runtime) on dev
    // and build. Locale is resolved from a cookie, then the browser language,
    // then the base locale.
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./paraglide",
      strategy: ["cookie", "preferredLanguage", "baseLocale"],
      emitTsDeclarations: true,
    }),
  ],
  resolve: {
    // `@/` → app root. Regex form keeps scoped packages like @heroui/react intact.
    alias: [{ find: /^@\//, replacement: `${root}/` }],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});
