// Pure Web Crypto JWT — no dependencies, works in browser and server.
// Adapted from mohshoo/src/utils/jwt.ts

const ALGORITHM = { name: "HMAC", hash: "SHA-256" };
const TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

export type SessionPayload = {
  sub: string; // user id
  email: string;
  name: string;
  image?: string | null;
  iat: number;
  exp: number;
};

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

function encodeJson(obj: object): string {
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
async function getKey(): Promise<CryptoKey> {
  if (_key) return _key;
  const secret = process.env.AUTH_SECRET ?? "dev-secret-please-change";
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  _key = await crypto.subtle.importKey("raw", raw, ALGORITHM, false, ["sign", "verify"]);
  return _key;
}

export async function createSessionToken(user: {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
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
    if (!payload?.sub || !payload.email || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
