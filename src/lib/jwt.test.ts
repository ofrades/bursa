import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, isSessionPayload, verifySessionToken } from "./jwt";

const originalSecret = process.env.AUTH_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

describe("session JWT", () => {
  it("fails closed when AUTH_SECRET is absent", async () => {
    delete process.env.AUTH_SECRET;
    await expect(createSessionToken({ id: "u1", sessionVersion: 0 })).rejects.toThrow(
      "AUTH_SECRET is required",
    );
  });

  it("contains only an identifier, version, and timestamps", async () => {
    process.env.AUTH_SECRET = "test-only-secret";
    const token = await createSessionToken({ id: "u1", sessionVersion: 4 });
    const payload = await verifySessionToken(token);
    expect(payload).toMatchObject({ sub: "u1", ver: 4 });
    expect(Object.keys(payload ?? {}).sort()).toEqual(["exp", "iat", "sub", "ver"]);
  });

  it("intentionally rejects legacy sessions without a DB session version", () => {
    expect(isSessionPayload({ sub: "legacy", iat: 1, exp: 2 })).toBe(false);
  });
});
