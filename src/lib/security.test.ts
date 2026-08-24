import { afterEach, describe, expect, it } from "vitest";
import { getAppOrigin, isAllowedRedirect } from "./app-url";
import { paidEuroAmount } from "./stripe-payment";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("application origin", () => {
  it("fails closed for an unconfigured non-local origin", () => {
    delete process.env.BETTER_AUTH_URL;
    process.env.NODE_ENV = "development";
    expect(() => getAppOrigin(new Request("https://attacker.example/path"))).toThrow(
      "BETTER_AUTH_URL is required",
    );
  });

  it("requires the fixed production origin", () => {
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_URL = "https://attacker.example";
    expect(() => getAppOrigin(new Request("https://bursa.mohshoo.com"))).toThrow(
      "BETTER_AUTH_URL must be https://bursa.mohshoo.com",
    );
  });

  it("rejects redirects to another origin", () => {
    expect(isAllowedRedirect("https://evil.example/dashboard", "https://bursa.mohshoo.com")).toBe(
      false,
    );
  });
});

describe("Stripe checkout validation", () => {
  it("credits only the signed paid EUR total", () => {
    expect(
      paidEuroAmount({
        mode: "payment",
        payment_status: "paid",
        currency: "eur",
        amount_total: 500,
      }),
    ).toBe(500);
    expect(
      paidEuroAmount({
        mode: "payment",
        payment_status: "unpaid",
        currency: "eur",
        amount_total: 500,
      }),
    ).toBeNull();
    expect(
      paidEuroAmount({
        mode: "payment",
        payment_status: "paid",
        currency: "usd",
        amount_total: 500,
      }),
    ).toBeNull();
    expect(
      paidEuroAmount({
        mode: "payment",
        payment_status: "paid",
        currency: "eur",
        amount_total: 10_001,
      }),
    ).toBeNull();
    expect(
      paidEuroAmount({
        mode: "payment",
        payment_status: "paid",
        currency: "eur",
        amount_total: 99,
      }),
    ).toBeNull();
  });
});
