import { createFileRoute } from "@tanstack/react-router";
import { and, eq, gte, lt } from "drizzle-orm";
import { getSecret } from "../../../../secrets";
import { getAppOrigin } from "../../../../lib/app-url";
import { parseCookies } from "../../../../lib/session";

const OAUTH_COOKIE = "__oauth_binding";

async function sha256b64u(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const Route = createFileRoute("/api/auth/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getDb } = await import("../../../../lib/db");
        const { oauthState, user } = await import("../../../../lib/schema");
        const { createSessionToken } = await import("../../../../lib/jwt");
        const { makeSessionCookie } = await import("../../../../lib/session");
        const db = await getDb();

        const requestUrl = new URL(request.url);
        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");
        const errorParam = requestUrl.searchParams.get("error");

        const clearBinding = `${OAUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/auth/google/callback; Max-Age=0`;
        const fail = (msg: string) =>
          new Response(null, {
            status: 302,
            headers: { Location: `/?error=${encodeURIComponent(msg)}`, "Set-Cookie": clearBinding },
          });

        if (errorParam) return fail(errorParam);
        if (!code || !state) return fail("Missing code or state");

        const expiry = new Date(Date.now() - 10 * 60 * 1000);
        const browserBinding = parseCookies(request.headers.get("cookie"))[OAUTH_COOKIE];
        if (!browserBinding) return fail("Invalid or expired state");
        const browserBindingHash = await sha256b64u(browserBinding);
        const [stateRow] = await db
          .delete(oauthState)
          .where(
            and(
              eq(oauthState.state, state),
              eq(oauthState.browserBindingHash, browserBindingHash),
              gte(oauthState.createdAt, expiry),
            ),
          )
          .returning();
        if (!stateRow) return fail("Invalid or expired state");

        db.delete(oauthState)
          .where(lt(oauthState.createdAt, expiry))
          .catch(() => {});

        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = await getSecret("GOOGLE_CLIENT_SECRET");
        if (!clientId || !clientSecret) return fail("OAuth not configured");

        const origin = getAppOrigin(request);
        const redirectUri = `${origin}/api/auth/google/callback`;

        // Exchange code for tokens
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
            code_verifier: stateRow.codeVerifier,
          }),
        });

        if (!tokenRes.ok) return fail("Token exchange failed");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tokenData: any = await tokenRes.json();
        const idToken: string = tokenData?.id_token;
        if (!idToken) return fail("Missing id_token");

        // Verify token with Google
        const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
        if (!infoRes.ok) return fail("Invalid Google token");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info: any = await infoRes.json();

        if (info.aud !== clientId) return fail("Token audience mismatch");
        if (!["accounts.google.com", "https://accounts.google.com"].includes(info.iss))
          return fail("Token issuer mismatch");
        if (!Number.isFinite(Number(info.exp)) || Number(info.exp) <= Math.floor(Date.now() / 1000))
          return fail("Expired Google token");
        if (info.email_verified !== "true" && info.email_verified !== true)
          return fail("Email not verified");

        const email: string = info.email;
        const name: string = info.name ?? email;
        const image: string | undefined = info.picture;

        if (!email) return fail("No email in token");

        // Upsert user
        let [existingUser] = await db
          .select()
          .from(user)
          .where(eq(user.email, email.toLowerCase()))
          .limit(1);

        if (!existingUser) {
          [existingUser] = await db
            .insert(user)
            .values({ name, email: email.toLowerCase(), image })
            .returning();
        }

        // Create signed session cookie
        const token = await createSessionToken({
          id: existingUser.id,
          sessionVersion: existingUser.sessionVersion,
        });

        const headers = new Headers({ Location: "/dashboard" });
        headers.append("Set-Cookie", makeSessionCookie(token));
        headers.append("Set-Cookie", clearBinding);
        return new Response(null, {
          status: 302,
          headers,
        });
      },
    },
  },
});
