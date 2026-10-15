import { describe, expect, it } from "vitest";
import {
  assertInFuture,
  cardExpiresBefore,
  daysUntil,
  formatDanishDate,
  isDue,
  localDateTimeToUtc,
} from "../../app/lib/preorder/dates";

describe("localDateTimeToUtc (dansk tid → UTC)", () => {
  it("vintertid: kl. 9 i København er kl. 8 UTC", () => {
    expect(localDateTimeToUtc("2026-12-01", 9).toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });

  it("sommertid: kl. 9 i København er kl. 7 UTC", () => {
    expect(localDateTimeToUtc("2026-07-01", 9).toISOString()).toBe("2026-07-01T07:00:00.000Z");
  });

  it("rammer rigtigt på dagene med tidsskift", () => {
    // Sommertid starter 29. marts 2026 kl. 02:00 → 03:00
    expect(localDateTimeToUtc("2026-03-29", 9).toISOString()).toBe("2026-03-29T07:00:00.000Z");
    // Sommertid slutter 25. oktober 2026 kl. 03:00 → 02:00
    expect(localDateTimeToUtc("2026-10-25", 9).toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });

  it("midnat dansk tid lander på dagen før i UTC", () => {
    expect(localDateTimeToUtc("2027-01-01", 0).toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });

  it("afviser datoer, der ikke findes, og forkerte formater", () => {
    expect(() => localDateTimeToUtc("2026-02-30")).toThrow();
    expect(() => localDateTimeToUtc("1/12/2026")).toThrow();
    expect(() => localDateTimeToUtc("2026-13-01")).toThrow();
  });
});

describe("assertInFuture", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("accepterer fremtiden og afviser nu og fortiden", () => {
    expect(() => assertInFuture(new Date("2026-10-11T12:00:01Z"), now)).not.toThrow();
    expect(() => assertInFuture(now, now)).toThrow();
    expect(() => assertInFuture(new Date("2026-10-10T12:00:00Z"), now)).toThrow();
  });
});

describe("isDue / daysUntil", () => {
  const now = new Date("2026-12-01T08:00:00Z");
  it("er forfalden fra og med forfaldsøjeblikket", () => {
    expect(isDue("2026-12-01T08:00:00Z", now)).toBe(true);
    expect(isDue("2026-12-01T07:59:59Z", now)).toBe(true);
    expect(isDue("2026-12-01T08:00:01Z", now)).toBe(false);
  });

  it("ingen forfaldsdato betyder ikke forfalden", () => {
    expect(isDue(null, now)).toBe(false);
    expect(isDue(undefined, now)).toBe(false);
  });

  it("afviser en forfaldsdato, der ikke kan læses", () => {
    expect(() => isDue("i morgen", now)).toThrow();
  });

  it("tæller hele dage, rundet op", () => {
    expect(daysUntil("2026-12-02T08:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-12-02T08:00:01Z", now)).toBe(2);
    expect(daysUntil("2026-11-30T08:00:00Z", now)).toBe(-1);
  });
});

describe("cardExpiresBefore", () => {
  it("et kort med udløb 12/2026 kan bruges hele december", () => {
    expect(cardExpiresBefore(12, 2026, "2026-12-31T22:59:59Z")).toBe(false);
    expect(cardExpiresBefore(12, 2026, "2027-01-01T00:00:00Z")).toBe(true);
  });

  it("forfald efter udløbsmåneden er et problem", () => {
    expect(cardExpiresBefore(11, 2026, "2026-12-01T08:00:00Z")).toBe(true);
    expect(cardExpiresBefore(1, 2027, "2026-12-01T08:00:00Z")).toBe(false);
  });
});

describe("formatDanishDate", () => {
  it("skriver datoen i dansk tid, også når UTC er dagen før", () => {
    expect(formatDanishDate(new Date("2026-11-12T08:00:00Z"))).toBe("12. november 2026");
    // 23:30 UTC 30. november er 00:30 dansk tid 1. december.
    expect(formatDanishDate(new Date("2026-11-30T23:30:00Z"))).toBe("1. december 2026");
  });
});
