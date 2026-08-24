import { createFileRoute } from "@tanstack/react-router";
import { getAppOrigin } from "../../../../lib/app-url";

function b64uEncode(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256b64u(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return b64uEncode(digest);
}

function randomString(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return b64uEncode(arr.buffer);
}

const OAUTH_COOKIE = "__oauth_binding";

export const Route = createFileRoute("/api/auth/google/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getDb } = await import("../../../../lib/db");
        const { oauthState } = await import("../../../../lib/schema");
        const db = await getDb();

        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId) return new Response("Missing GOOGLE_CLIENT_ID", { status: 500 });

        const state = randomString(16);
        const browserBinding = randomString(32);
        const codeVerifier = randomString(32);
        const codeChallenge = await sha256b64u(codeVerifier);
        const browserBindingHash = await sha256b64u(browserBinding);

        await db.insert(oauthState).values({ state, codeVerifier, browserBindingHash });

        const origin = getAppOrigin(request);
        const redirectUri = `${origin}/api/auth/google/callback`;

        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", "openid email profile");
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", codeChallenge);
        authUrl.searchParams.set("code_challenge_method", "S256");

        const cookie = [
          `${OAUTH_COOKIE}=${browserBinding}`,
          "HttpOnly",
          "SameSite=Lax",
          "Path=/api/auth/google/callback",
          "Max-Age=600",
          process.env.NODE_ENV === "production" ? "Secure" : "",
        ]
          .filter(Boolean)
          .join("; ");
        return new Response(null, {
          status: 302,
          headers: { Location: authUrl.toString(), "Set-Cookie": cookie },
        });
      },
    },
  },
});
