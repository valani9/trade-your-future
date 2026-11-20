export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function id(): string {
  return crypto.randomUUID();
}

const DAY = 86_400_000;

export function formatEventDate(start: Date, timeZone: string, end?: Date | null): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
  if (end) {
    const sameDay =
      new Intl.DateTimeFormat("en-CA", { timeZone }).format(start) ===
      new Intl.DateTimeFormat("en-CA", { timeZone }).format(end);
    if (sameDay) {
      const endTime = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      }).format(end);
      return `${date} · ${time} – ${endTime}`;
    }
  }
  return `${date} · ${time}`;
}

export function formatDayLabel(start: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(start);
}

export function formatRelative(startsAt: Date, now = new Date()): string {
  const diff = startsAt.getTime() - now.getTime();
  if (diff < 0) return "Started";
  const hours = Math.round(diff / 3_600_000);
  if (hours < 1) return "Starting soon";
  if (hours < 24) return `In ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(diff / DAY);
  return `In ${days} ${days === 1 ? "day" : "days"}`;
}

export function timeLeftLabel(expiresAt: Date, now = new Date()): string {
  const diff = expiresAt.getTime() - now.getTime();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}
