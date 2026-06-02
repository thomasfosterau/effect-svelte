/** Formats an ISO timestamp as a relative "time ago" string. */
export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const units: Array<[number, string]> = [
    [60 * 60 * 24 * 365, "year"],
    [60 * 60 * 24 * 30, "month"],
    [60 * 60 * 24, "day"],
    [60 * 60, "hour"],
    [60, "minute"],
  ];
  for (const [limit, name] of units) {
    if (seconds >= limit) {
      const count = Math.floor(seconds / limit);
      return `${count} ${name}${count === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

/** Extracts a display hostname from a URL. */
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
