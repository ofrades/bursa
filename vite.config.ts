import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    nitro({
      rollupConfig: { external: [/^@sentry\//] },
      // Scheduled tasks — powered by croner (built into Nitro 3)
      scheduledTasks: {
        // Nightly at 23:00 — smart scheduler, respects per-stock next_check_at
        '0 23 * * *': ['stocks:nightly'],
      },
      tasks: {
        'stocks:nightly': { handler: './server/tasks/stocks/nightly' },
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
