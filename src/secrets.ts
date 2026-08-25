export type SecretName =
  | "AUTH_SECRET"
  | "FMP_API_KEY"
  | "GOOGLE_CLIENT_SECRET"
  | "OPENROUTER_API_KEY"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_WEBHOOK_SECRET";

type SecretWorkerEnv = {
  readonly [Name in SecretName]?: SecretsStoreSecret;
};

export async function getSecret(name: SecretName): Promise<string | undefined> {
  // Keep the Worker-only module out of the browser bundle. Plain Vite local
  // development cannot load it and intentionally falls back to process.env.
  const moduleName = "cloudflare:workers";
  let workerEnv: SecretWorkerEnv | undefined;
  try {
    const workerModule: { readonly env: SecretWorkerEnv } = await import(
      /* @vite-ignore */ moduleName
    );
    workerEnv = workerModule.env;
  } catch {
    return process.env[name];
  }

  const binding = workerEnv[name];
  return binding ? binding.get() : process.env[name];
}
