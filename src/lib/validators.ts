import { z } from "zod";

const symbolInput = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .transform((symbol) => symbol.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9.^=-]+$/));

const optionalLabelInput = z.string().trim().min(1).max(200).optional();

export const symbolListInput = z.object({ symbols: z.array(symbolInput).max(100) });
export const symbolInputObject = z.object({ symbol: symbolInput });
export const stockStateInput = z.object({
  symbol: symbolInput,
  name: optionalLabelInput,
  exchange: optionalLabelInput,
});
