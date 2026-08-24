// Pure Web Crypto JWT — no dependencies, works in browser and server.
// Adapted from mohshoo/src/utils/jwt.ts

import { getSecret } from "../secrets";

const ALGORITHM = { name: "HMAC", hash: "SHA-256" };
const TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

export type SessionPayload = {
  sub: string; // user id
  ver: number;
  iat: number;
  exp: number;
};

export function isSessionPayload(
  payload: Partial<SessionPayload> | null,
): payload is SessionPayload {
  return Boolean(
    payload?.sub &&
    Number.isInteger(payload.ver) &&
    Number.isInteger(payload.iat) &&
    Number.isInteger(payload.exp),
  );
}

function b64uEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64uDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

type JwtHeader = { alg: "HS256"; typ: "JWT" };

function encodeJson(obj: SessionPayload | JwtHeader): string {
  return b64uEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

function decodeJson<T>(segment: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64uDecode(segment))) as T;
  } catch {
    return null;
  }
}

// Derive a 32-byte key from AUTH_SECRET using SHA-256 so any string works.
let _key: CryptoKey | null = null;
let _keySecret: string | null = null;
async function getKey(): Promise<CryptoKey> {
  const secret = await getSecret("AUTH_SECRET");
  if (!secret) throw new Error("AUTH_SECRET is required");
  if (_key && _keySecret === secret) return _key;
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  _key = await crypto.subtle.importKey("raw", raw, ALGORITHM, false, ["sign", "verify"]);
  _keySecret = secret;
  return _key;
}

export async function createSessionToken(user: {
  id: string;
  sessionVersion: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    ver: user.sessionVersion,
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  };
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const body = encodeJson(payload);
  const input = `${header}.${body}`;
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return `${input}.${b64uEncode(new Uint8Array(sig))}`;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    if (!token || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, b, sig] = parts;
    const header = decodeJson<{ alg?: string }>(h);
    if (header?.alg !== "HS256") return null;
    const key = await getKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64uDecode(sig).buffer as ArrayBuffer,
      new TextEncoder().encode(`${h}.${b}`),
    );
    if (!valid) return null;
    const payload = decodeJson<SessionPayload>(b);
    if (!isSessionPayload(payload)) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
