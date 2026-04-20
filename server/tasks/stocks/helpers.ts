// Shared helpers for stock scheduler tasks

export function isMarketHours(): boolean {
  // NYSE hours: Mon–Fri 9:30–16:00 Eastern
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false; // weekend

  // Convert to Eastern Time (UTC-4 in EDT, UTC-5 in EST)
  // Simple approximation: use UTC-4 (EDT, Mar–Nov)
  const month = now.getUTCMonth() + 1;
  const offsetHours = month >= 3 && month <= 11 ? 4 : 5;
  const etHour = (now.getUTCHours() - offsetHours + 24) % 24;
  const etMin = now.getUTCMinutes();
  const etMinutes = etHour * 60 + etMin;

  return etMinutes >= 9 * 60 + 30 && etMinutes < 16 * 60;
}

export function isEarningsSoon(earningsDate: Date | null | undefined, withinHours = 48): boolean {
  if (!earningsDate) return false;
  const diff = earningsDate.getTime() - Date.now();
  return diff > 0 && diff < withinHours * 60 * 60 * 1000;
}
