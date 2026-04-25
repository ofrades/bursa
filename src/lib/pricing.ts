/**
 * OpenRouter pricing table — input/output per 1M tokens in USD.
 * Updated 2026-04-24. These are OpenRouter's rates (not the provider's).
 * Fallback for unknown models: $0.50 / $1.50 per 1M.
 */

const PRICING_TABLE: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  // Moonshot AI
  "moonshotai/kimi-k2.6": { inputPer1M: 0.7448, outputPer1M: 4.655 },

  // Google Gemini
  "google/gemini-2.0-flash-001": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "google/gemini-2.5-flash-preview": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "google/gemini-2.5-pro-preview": { inputPer1M: 1.25, outputPer1M: 10.0 },

  // OpenAI
  "openai/gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "openai/gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "openai/gpt-4.1": { inputPer1M: 2.0, outputPer1M: 8.0 },
  "openai/gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "openai/gpt-4.1-nano": { inputPer1M: 0.1, outputPer1M: 0.4 },

  // Anthropic
  "anthropic/claude-3-5-haiku": { inputPer1M: 0.8, outputPer1M: 4.0 },
  "anthropic/claude-3-5-sonnet": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "anthropic/claude-3-7-sonnet": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "anthropic/claude-opus-4": { inputPer1M: 15.0, outputPer1M: 75.0 },

  // DeepSeek
  "deepseek/deepseek-chat": { inputPer1M: 0.27, outputPer1M: 1.1 },
  "deepseek/deepseek-r1": { inputPer1M: 0.55, outputPer1M: 2.19 },

  // Meta
  "meta-llama/llama-3.3-70b-instruct": { inputPer1M: 0.12, outputPer1M: 0.3 },
  "meta-llama/llama-4-maverick": { inputPer1M: 0.2, outputPer1M: 0.6 },

  // Mistral
  "mistralai/mistral-small-3.1-24b-instruct": { inputPer1M: 0.1, outputPer1M: 0.3 },

  // xAI
  "xai/grok-3-beta": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "xai/grok-3-mini-beta": { inputPer1M: 0.3, outputPer1M: 0.5 },
};

const FALLBACK = { inputPer1M: 0.5, outputPer1M: 1.5 };

export function getModelPricing(modelId: string) {
  return PRICING_TABLE[modelId] ?? FALLBACK;
}

export function calculateCostCents(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = getModelPricing(modelId);
  const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;
  const totalUsd = inputCost + outputCost;
  // Convert to cents, round up to nearest cent so we never under-charge
  return Math.ceil(totalUsd * 100);
}

export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(cents / 100);
}
