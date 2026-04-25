import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  fmt: {
    ignorePatterns: ["src/routeTree.gen.ts"],
  },
  plugins: [
    devtools(),
    nitro({
      rollupConfig: {
        external: [/^@sentry\//],
        // Inject __dirname/__filename into @deno/shim-deno which is bundled as ESM
        // but references these CJS globals (pulled in by yahoo-finance2)
        plugins: [
          {
            name: "inject-cjs-globals",
            transform(code, id) {
              if (id.includes("@deno") && code.includes("__dirname")) {
                const prefix = [
                  "import { fileURLToPath as __furl } from 'url';",
                  "import { dirname as __dirnamefn } from 'path';",
                  "const __filename = __furl(import.meta.url);",
                  "const __dirname = __dirnamefn(__filename);",
                ].join("\n");
                return { code: prefix + "\n" + code, map: null };
              }
            },
          },
        ],
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;
