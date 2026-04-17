/**
 * Time-zone helpers for the schedule picker.
 *
 * JavaScript's built-in Date uses either UTC or the browser's local TZ — there
 * is no native way to build a Date from wall-clock values in an arbitrary IANA
 * time zone. These helpers fill that gap using Intl.DateTimeFormat.
 */

export interface TzOption {
    value: string // IANA timezone, e.g. "America/Los_Angeles"
    label: string
}

const COMMON_US_TZ: TzOption[] = [
    { value: "America/Los_Angeles", label: "Pacific (PT)" },
    { value: "America/Denver", label: "Mountain (MT)" },
    { value: "America/Chicago", label: "Central (CT)" },
    { value: "America/New_York", label: "Eastern (ET)" },
    { value: "UTC", label: "UTC" },
]

export const PACIFIC_TZ = "America/Los_Angeles"

/** Browser's detected IANA time zone, or Pacific as a safe fallback. */
export function getBrowserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || PACIFIC_TZ
    } catch {
        return PACIFIC_TZ
    }
}

/**
 * Returns the TZ dropdown options, with the browser-local TZ listed first and
 * labeled "your local time". Avoids duplicating the local TZ if it's already
 * in the common-US list.
 */
export function getTimeZoneOptions(): TzOption[] {
    const local = getBrowserTimeZone()
    const match = COMMON_US_TZ.find(o => o.value === local)
    if (match) {
        return [
            { value: match.value, label: `${match.label} — your local time` },
            ...COMMON_US_TZ.filter(o => o.value !== local),
        ]
    }
    return [
        { value: local, label: `${local} — your local time` },
        ...COMMON_US_TZ,
    ]
}

/**
 * Convert wall-clock values in a given time zone to a UTC Date (absolute instant).
 *
 * Example: zonedWallClockToUtc(2026, 4, 17, 1, 15, "America/Los_Angeles")
 *          → Date representing 2026-04-17T08:15:00Z (1:15 AM PDT).
 *
 * Uses a two-pass convergence so that wall-clocks within 1 hour of a DST
 * transition still resolve correctly: the TZ offset at the naive-UTC guess
 * may differ from the offset at the actual target instant, so we sample
 * offsets at both and reconcile.
 */
export function zonedWallClockToUtc(
    year: number,
    month: number,  // 1-12
    day: number,
    hour: number,
    minute: number,
    tz: string
): Date {
    // Interpret the wall-clock as if it were UTC — this is the target we're
    // trying to hit once we've shifted by the TZ offset.
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0)

    // Offset (in ms) of `tz` at a given absolute UTC instant. Negative west of UTC.
    const offsetAt = (utcMs: number): number => {
        const wall = getWallClockInTz(new Date(utcMs), tz)
        const wallAsUtc = Date.UTC(
            wall.year, wall.month - 1, wall.day,
            wall.hour, wall.minute, 0
        )
        return wallAsUtc - utcMs
    }

    // Pass 1: sample offset using the naive-UTC guess.
    const offset1 = offsetAt(targetAsUtc)
    const firstGuess = targetAsUtc - offset1

    // Pass 2: sample offset at the first guess. Near DST transitions, these
    // disagree — use offset2 (the offset at the actual target instant).
    const offset2 = offsetAt(firstGuess)
    const finalOffset = offset1 === offset2 ? offset1 : offset2

    return new Date(targetAsUtc - finalOffset)
}

/** Get the wall-clock components of a UTC instant as seen in a given TZ. */
export function getWallClockInTz(date: Date, tz: string): {
    year: number; month: number; day: number; hour: number; minute: number
} {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
        hour12: false,
    }).formatToParts(date)
    const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? "0", 10)
    return {
        year: get("year"),
        month: get("month"),
        day: get("day"),
        hour: get("hour") % 24,  // Intl returns 24 for midnight in some locales
        minute: get("minute"),
    }
}

/** Format a Date in a given TZ. */
export function formatInTimeZone(
    date: Date,
    tz: string,
    options: Intl.DateTimeFormatOptions = {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    }
): string {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: tz }).format(date)
}

/** Short TZ name for a date in a TZ, e.g. "PDT", "EDT". */
export function getTimeZoneAbbreviation(date: Date, tz: string): string {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "short",
    }).formatToParts(date)
    return parts.find(p => p.type === "timeZoneName")?.value ?? tz
}
