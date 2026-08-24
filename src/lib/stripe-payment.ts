type CompletedCheckout = {
  mode?: string | null;
  payment_status?: string | null;
  currency?: string | null;
  amount_total?: number | null;
};

export function paidEuroAmount(session: CompletedCheckout): number | null {
  if (session.mode !== "payment" || session.payment_status !== "paid") return null;
  if (session.currency?.toLowerCase() !== "eur") return null;
  if (!Number.isSafeInteger(session.amount_total)) return null;
  const amount = session.amount_total as number;
  return amount >= 100 && amount <= 10_000 ? amount : null;
}
