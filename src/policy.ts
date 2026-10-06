import type { OfferPolicy, Opening } from "./types";

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

export const SALON_TIME_ZONE = process.env.SALON_TIME_ZONE ?? "America/Los_Angeles";

/** Lena's rule: same-day openings get 15 minutes per round. */
export const SAME_DAY_WINDOW_MS = 15 * MINUTE;
/**
 * Lena hadn't decided on a window for openings days away. Two hours keeps
 * things moving through the list in a working day while giving people who
 * aren't glued to their phone a fair chance. Easy to change here.
 */
export const FUTURE_WINDOW_MS = 2 * HOUR;
/** Stop making offers this close to the start; the chair needs prep time. */
export const CUTOFF_BUFFER_MS = 30 * MINUTE;
/** Lena wants several people contacted at once. */
export const DEFAULT_OFFERS_PER_ROUND = 3;

export type PolicyOverrides = {
  offersPerRound?: number;
  /** Demo/testing hook so an expiry can be watched without waiting 15 minutes. */
  responseWindowSeconds?: number;
};

function calendarDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function resolvePolicy(
  opening: Pick<Opening, "startAt">,
  now: Date = new Date(),
  overrides: PolicyOverrides = {},
  timeZone: string = SALON_TIME_ZONE,
): OfferPolicy {
  const start = new Date(opening.startAt);
  const sameDay = calendarDay(start, timeZone) === calendarDay(now, timeZone);

  let responseWindowMs = sameDay ? SAME_DAY_WINDOW_MS : FUTURE_WINDOW_MS;
  let responseWindowLabel = sameDay
    ? "15 minutes per round (same-day opening)"
    : "2 hours per round (opening is on a later day)";

  if (overrides.responseWindowSeconds !== undefined) {
    responseWindowMs = overrides.responseWindowSeconds * 1000;
    responseWindowLabel = `${overrides.responseWindowSeconds} seconds per round (demo override)`;
  }

  return {
    offersPerRound: overrides.offersPerRound ?? DEFAULT_OFFERS_PER_ROUND,
    responseWindowMs,
    responseWindowLabel,
    cutoffBufferMs: CUTOFF_BUFFER_MS,
  };
}
