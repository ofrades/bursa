import * as cf from "cloudflare:workers";

interface WorkerEnv {
  readonly DB: D1Database;
}

// The proxy avoids reading cloudflare:workers at module initialization, which
// TanStack Start development does not support.
export const env = new Proxy({} as WorkerEnv, {
  get(_, prop) {
    return cf.env[prop as keyof typeof cf.env];
  },
});
