import { z } from "zod";

const probability = z.number().finite().min(0).max(1);
export const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  value: z.string(),
  probability,
  probabilities: z.record(z.string(), probability),
  confidence: probability,
});

export const businessJudgmentsSchema = z.object({
  model: z.string(),
  revisionQuality: choiceAnswerSchema.extend({
    value: z.enum(["RECURRING", "ONE_OFF", "MIXED", "INSUFFICIENT_EVIDENCE"]),
  }),
  businessMomentum: choiceAnswerSchema.extend({
    value: z.enum(["IMPROVING", "STABLE", "WEAKENING", "INSUFFICIENT_EVIDENCE"]),
  }),
  evidence: z.array(z.object({ title: z.string(), url: z.string().url().nullable() })),
});

export type BusinessJudgments = z.infer<typeof businessJudgmentsSchema>;
