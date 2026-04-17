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
 */
export function zonedWallClockToUtc(
    year: number,
    month: number,  // 1-12
    day: number,
    hour: number,
    minute: number,
    tz: string
): Date {
    // Build an instant AS IF these wall-clock values were UTC.
    const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
    // Ask Intl what that UTC instant looks like in the target TZ.
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
    }).formatToParts(new Date(naiveUtc))
    const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? "0", 10)
    const tzUtc = Date.UTC(
        get("year"), get("month") - 1, get("day"),
        get("hour") % 24, get("minute"), get("second")
    )
    // Shift naiveUtc by the TZ offset at that instant to get the real UTC instant.
    const offset = tzUtc - naiveUtc
    return new Date(naiveUtc - offset)
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
