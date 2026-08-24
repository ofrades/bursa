import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  build: { rollupOptions: { external: ["cloudflare:workers"] } },
  fmt: {
    ignorePatterns: ["src/routeTree.gen.ts"],
  },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
});

export default config;
