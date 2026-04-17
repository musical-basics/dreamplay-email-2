/**
 * Tests for tz-utils — the scheduled-send timezone math.
 *
 * Run: node --test --experimental-strip-types lib/tz-utils.test.ts
 *
 * These tests verify that zonedWallClockToUtc correctly translates a
 * wall-clock time in a named IANA time zone to an absolute UTC instant,
 * across DST boundaries and round-trips. A bug here means scheduled sends
 * fire at the wrong instant for real subscribers.
 */

import { test, describe } from "node:test"
import { strictEqual, deepStrictEqual } from "node:assert"
import {
    zonedWallClockToUtc,
    getWallClockInTz,
    formatInTimeZone,
    getTimeZoneAbbreviation,
    PACIFIC_TZ,
} from "./tz-utils.ts"

describe("zonedWallClockToUtc", () => {
    // ── Pacific Time ──────────────────────────────────────────────────────
    test("1:00 AM PDT (April, DST active) → 08:00 UTC", () => {
        const instant = zonedWallClockToUtc(2026, 4, 17, 1, 0, "America/Los_Angeles")
        strictEqual(instant.toISOString(), "2026-04-17T08:00:00.000Z")
    })

    test("1:00 AM PST (January, standard time) → 09:00 UTC", () => {
        const instant = zonedWallClockToUtc(2026, 1, 15, 1, 0, "America/Los_Angeles")
        strictEqual(instant.toISOString(), "2026-01-15T09:00:00.000Z")
    })

    test("11:30 PM PDT → 06:30 UTC next day", () => {
        const instant = zonedWallClockToUtc(2026, 4, 17, 23, 30, "America/Los_Angeles")
        strictEqual(instant.toISOString(), "2026-04-18T06:30:00.000Z")
    })

    // ── Eastern Time ──────────────────────────────────────────────────────
    test("4:00 AM EDT (April, DST active) → 08:00 UTC", () => {
        const instant = zonedWallClockToUtc(2026, 4, 17, 4, 0, "America/New_York")
        strictEqual(instant.toISOString(), "2026-04-17T08:00:00.000Z")
    })

    test("4:00 AM EST (January, standard time) → 09:00 UTC", () => {
        const instant = zonedWallClockToUtc(2026, 1, 15, 4, 0, "America/New_York")
        strictEqual(instant.toISOString(), "2026-01-15T09:00:00.000Z")
    })

    // ── UTC passthrough ───────────────────────────────────────────────────
    test("08:00 AM UTC → 08:00 UTC", () => {
        const instant = zonedWallClockToUtc(2026, 4, 17, 8, 0, "UTC")
        strictEqual(instant.toISOString(), "2026-04-17T08:00:00.000Z")
    })

    // ── Cross-zone consistency ────────────────────────────────────────────
    test("1:00 AM PDT and 4:00 AM EDT resolve to the SAME UTC instant", () => {
        const pt = zonedWallClockToUtc(2026, 4, 17, 1, 0, "America/Los_Angeles")
        const et = zonedWallClockToUtc(2026, 4, 17, 4, 0, "America/New_York")
        strictEqual(pt.toISOString(), et.toISOString())
    })

    // ── DST boundary: "spring forward" (2:00-3:00 AM doesn't exist) ──────
    test("1:59 AM PDT on spring-forward day is well-defined", () => {
        // 2026 spring forward: Sunday March 8, 2:00 AM → 3:00 AM
        const instant = zonedWallClockToUtc(2026, 3, 8, 1, 59, "America/Los_Angeles")
        // 1:59 AM PST (UTC-8) → 09:59 UTC
        strictEqual(instant.toISOString(), "2026-03-08T09:59:00.000Z")
    })

    test("3:00 AM PDT on spring-forward day is well-defined", () => {
        // First valid PDT instant
        const instant = zonedWallClockToUtc(2026, 3, 8, 3, 0, "America/Los_Angeles")
        // 3:00 AM PDT (UTC-7) → 10:00 UTC
        strictEqual(instant.toISOString(), "2026-03-08T10:00:00.000Z")
    })

    // ── DST boundary: "fall back" (1:00-2:00 AM happens twice) ───────────
    test("12:30 AM on fall-back day is well-defined (PDT)", () => {
        // 2026 fall back: Sunday November 1, 2:00 AM PDT → 1:00 AM PST
        const instant = zonedWallClockToUtc(2026, 11, 1, 0, 30, "America/Los_Angeles")
        // 12:30 AM PDT (UTC-7) → 07:30 UTC
        strictEqual(instant.toISOString(), "2026-11-01T07:30:00.000Z")
    })
})

describe("getWallClockInTz (round-trip)", () => {
    test("roundtrip: PDT wall-clock → UTC → PDT wall-clock preserves values", () => {
        const orig = { year: 2026, month: 4, day: 17, hour: 1, minute: 30 }
        const utc = zonedWallClockToUtc(orig.year, orig.month, orig.day, orig.hour, orig.minute, PACIFIC_TZ)
        const back = getWallClockInTz(utc, PACIFIC_TZ)
        deepStrictEqual(back, orig)
    })

    test("roundtrip: EST wall-clock → UTC → EST wall-clock preserves values", () => {
        const orig = { year: 2026, month: 1, day: 15, hour: 14, minute: 45 }
        const utc = zonedWallClockToUtc(orig.year, orig.month, orig.day, orig.hour, orig.minute, "America/New_York")
        const back = getWallClockInTz(utc, "America/New_York")
        deepStrictEqual(back, orig)
    })

    test("roundtrip across TZ: PDT wall-clock → UTC → EDT wall-clock is +3 hours", () => {
        const pdt = { year: 2026, month: 4, day: 17, hour: 1, minute: 0 }
        const utc = zonedWallClockToUtc(pdt.year, pdt.month, pdt.day, pdt.hour, pdt.minute, PACIFIC_TZ)
        const edt = getWallClockInTz(utc, "America/New_York")
        deepStrictEqual(edt, { year: 2026, month: 4, day: 17, hour: 4, minute: 0 })
    })
})

describe("getTimeZoneAbbreviation", () => {
    test("April date in LA returns PDT", () => {
        const d = new Date("2026-04-17T08:00:00Z")
        strictEqual(getTimeZoneAbbreviation(d, "America/Los_Angeles"), "PDT")
    })

    test("January date in LA returns PST", () => {
        const d = new Date("2026-01-15T09:00:00Z")
        strictEqual(getTimeZoneAbbreviation(d, "America/Los_Angeles"), "PST")
    })

    test("April date in NY returns EDT", () => {
        const d = new Date("2026-04-17T08:00:00Z")
        strictEqual(getTimeZoneAbbreviation(d, "America/New_York"), "EDT")
    })
})

describe("formatInTimeZone", () => {
    test("08:00 UTC formatted as PT wall-clock shows 1:00 AM", () => {
        const d = new Date("2026-04-17T08:00:00Z")
        const formatted = formatInTimeZone(d, "America/Los_Angeles", {
            hour: "numeric", minute: "2-digit", hour12: true,
        })
        strictEqual(formatted, "1:00 AM")
    })

    test("08:00 UTC formatted as ET wall-clock shows 4:00 AM", () => {
        const d = new Date("2026-04-17T08:00:00Z")
        const formatted = formatInTimeZone(d, "America/New_York", {
            hour: "numeric", minute: "2-digit", hour12: true,
        })
        strictEqual(formatted, "4:00 AM")
    })
})
