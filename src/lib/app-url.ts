const PRODUCTION_ORIGIN = "https://bursa.mohshoo.com";

export function getAppOrigin(request: Request): string {
  const configured = process.env.BETTER_AUTH_URL;
  if (process.env.NODE_ENV === "production") {
    if (configured !== PRODUCTION_ORIGIN) {
      throw new Error(`BETTER_AUTH_URL must be ${PRODUCTION_ORIGIN} in production`);
    }
    return PRODUCTION_ORIGIN;
  }

  if (configured) {
    const origin = new URL(configured).origin;
    if (origin !== configured.replace(/\/$/, ""))
      throw new Error("BETTER_AUTH_URL must be an origin");
    return origin;
  }

  const url = new URL(request.url);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("BETTER_AUTH_URL is required outside local development");
  }
  return url.origin;
}

export function isAllowedRedirect(url: string, appOrigin: string): boolean {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}
