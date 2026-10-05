import { z } from "zod";

const scoreInput = z.union([z.number(), z.string()]);

export function normalizeScore(value: number | string | null | undefined): number | null {
  const parsed = scoreInput.safeParse(value);
  if (!parsed.success) return null;
  const raw = Number(parsed.data);
  if (!Number.isFinite(raw)) return null;
  const scaled = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}
