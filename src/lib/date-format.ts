const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

function parseDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUtcDate(value: string | Date | null | undefined) {
  const date = parseDate(value);
  return date ? dateFormatter.format(date) : "—";
}

export function formatUtcDateTime(value: string | Date | null | undefined) {
  const date = parseDate(value);
  return date ? dateTimeFormatter.format(date) : "—";
}
