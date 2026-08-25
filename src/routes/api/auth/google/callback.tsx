import { Effect, Layer } from "effect";
import { and, eq, gte, lt } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { getAppOrigin } from "../../../../lib/app-url";
import { parseCookies } from "../../../../lib/session";
import { createSessionToken } from "../../../../lib/jwt";
import { makeSessionCookie } from "../../../../lib/session";
import { Database, query } from "../../../../lib/effect/services/database";
import { Secrets } from "../../../../lib/effect/services/secrets";
import { ExternalServiceError } from "../../../../lib/effect/errors";
import { oauthState, user } from "../../../../lib/schema";

const OAUTH_COOKIE = "__oauth_binding";

const sha256b64u = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  });

type GoogleTokenInfo = {
  aud: string;
  iss: string;
  exp: string | number;
  email_verified: string | boolean;
  email?: string;
  name?: string;
  picture?: string;
};

const googleCallbackProgram = Effect.fn("auth.google.callback")(function* (request: Request) {
  const clearBinding = `${OAUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/auth/google/callback; Max-Age=0`;
  const fail = (msg: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: `/?error=${encodeURIComponent(msg)}`,
        "Set-Cookie": clearBinding,
      },
    });

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const errorParam = requestUrl.searchParams.get("error");

  if (errorParam) return fail(errorParam);
  if (!code || !state) return fail("Missing code or state");

  const expiry = new Date(Date.now() - 10 * 60 * 1000);
  const browserBinding = parseCookies(request.headers.get("cookie"))[OAUTH_COOKIE];
  if (!browserBinding) return fail("Invalid or expired state");
  const browserBindingHash = yield* sha256b64u(browserBinding);

  const [stateRow] = yield* query((database) =>
    database
      .delete(oauthState)
      .where(
        and(
          eq(oauthState.state, state),
          eq(oauthState.browserBindingHash, browserBindingHash),
          gte(oauthState.createdAt, expiry),
        ),
      )
      .returning(),
  ).pipe(Effect.orDie);
  if (!stateRow) return fail("Invalid or expired state");

  yield* query((database) =>
    database.delete(oauthState).where(lt(oauthState.createdAt, expiry)),
  ).pipe(Effect.ignore);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const secrets = yield* Secrets;
  const clientSecret = yield* secrets
    .getOrThrow("GOOGLE_CLIENT_SECRET")
    .pipe(Effect.catch(() => Effect.succeed(null)));
  if (!clientId || !clientSecret) return fail("OAuth not configured");

  const origin = getAppOrigin(request);
  const redirectUri = `${origin}/api/auth/google/callback`;

  const postForm = (url: string, body: URLSearchParams) =>
    Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        }),
      catch: (cause) => new ExternalServiceError({ service: "google-oauth", cause }),
    });

  // Exchange code for tokens
  const tokenRes = yield* postForm(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: stateRow.codeVerifier,
    }),
  ).pipe(Effect.catch(() => Effect.succeed(null)));
  if (!tokenRes?.ok) return fail("Token exchange failed");
  const tokenData = (yield* Effect.promise(() => tokenRes.json())) as {
    id_token?: string;
  };
  const idToken = tokenData?.id_token;
  if (!idToken) return fail("Missing id_token");

  // Verify token with Google
  const infoRes = yield* Effect.tryPromise({
    try: () => fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`),
    catch: (cause) => new ExternalServiceError({ service: "google-oauth", cause }),
  }).pipe(Effect.catch(() => Effect.succeed(null)));
  if (!infoRes?.ok) return fail("Invalid Google token");
  const info = (yield* Effect.promise(() => infoRes.json())) as GoogleTokenInfo;

  if (info.aud !== clientId) return fail("Token audience mismatch");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(info.iss))
    return fail("Token issuer mismatch");
  if (!Number.isFinite(Number(info.exp)) || Number(info.exp) <= Math.floor(Date.now() / 1000))
    return fail("Expired Google token");
  if (info.email_verified !== "true" && info.email_verified !== true)
    return fail("Email not verified");

  const email = info.email ?? "";
  const name = info.name ?? email;
  const image = info.picture;

  if (!email) return fail("No email in token");

  // Upsert user
  let existingUser = yield* query((database) =>
    database.select().from(user).where(eq(user.email, email.toLowerCase())).limit(1),
  ).pipe(
    Effect.map((rows) => rows[0]),
    Effect.orDie,
  );

  if (!existingUser) {
    existingUser = yield* query((database) =>
      database.insert(user).values({ name, email: email.toLowerCase(), image }).returning(),
    ).pipe(
      Effect.map((rows) => rows[0]),
      Effect.orDie,
    );
  }

  // Create signed session cookie
  const token = yield* Effect.promise(() =>
    createSessionToken({
      id: existingUser.id,
      sessionVersion: existingUser.sessionVersion,
    }),
  );

  const headers = new Headers({ Location: "/dashboard" });
  headers.append("Set-Cookie", makeSessionCookie(token));
  headers.append("Set-Cookie", clearBinding);
  return new Response(null, { status: 302, headers });
});

const appLayer = Layer.merge(Database.layer, Secrets.layer);

export const Route = createFileRoute("/api/auth/google/callback")({
  server: {
    handlers: {
      GET: ({ request }) =>
        Effect.runPromise(googleCallbackProgram(request).pipe(Effect.provide(appLayer))),
    },
  },
});
