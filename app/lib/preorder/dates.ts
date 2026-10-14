// Datoer for forudbestilling.
//
// Butikken ligger i Danmark, så "frigivelse 1. december kl. 9" betyder dansk
// tid — men Shopify vil have tidspunkter i UTC. Forskellen er én time om
// vinteren og to om sommeren, og den skifter midt i perioder, vi kan finde på
// at bruge. Derfor regnes forskydningen ud for den konkrete dato.

export const SHOP_TIME_ZONE = "Europe/Copenhagen";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minutter som den givne tidszone ligger foran UTC på det givne øjeblik. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * "2026-12-01" kl. 09:00 dansk tid → Date i UTC.
 * Afviser datoer, der ikke findes (fx 2026-02-30).
 */
export function localDateTimeToUtc(
  date: string,
  hour = 9,
  minute = 0,
  timeZone = SHOP_TIME_ZONE,
): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Dato skal være ÅÅÅÅ-MM-DD, fik "${date}"`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  const check = new Date(naive);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`Datoen findes ikke: "${date}"`);
  }
  // To gennemløb, så vi rammer rigtigt også lige omkring sommertidsskiftet.
  let guess = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000;
  guess = naive - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/** Kræver at tidspunktet ligger i fremtiden — en forfaldsdato i fortiden er en fejl. */
export function assertInFuture(when: Date, now: Date = new Date()): void {
  if (when.getTime() <= now.getTime()) {
    throw new Error(
      `Tidspunktet ${when.toISOString()} ligger ikke i fremtiden (nu: ${now.toISOString()})`,
    );
  }
}

/** Er betalingen forfalden? Forfaldsøjeblikket regnes som forfaldent. */
export function isDue(dueAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!dueAt) return false;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) throw new Error(`Ugyldig forfaldsdato: "${dueAt}"`);
  return due <= now.getTime();
}

/** Hele dage til forfald, rundet op. Negativ, når forfaldet er passeret. */
export function daysUntil(dueAt: string, now: Date = new Date()): number {
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) throw new Error(`Ugyldig forfaldsdato: "${dueAt}"`);
  return Math.ceil((due - now.getTime()) / DAY_MS);
}

/**
 * Udløber kortet før forfald? Et kort med udløb 12/2026 kan bruges hele
 * december 2026, så det regnes som gyldigt til og med månedens sidste dag.
 */
export function cardExpiresBefore(
  expiryMonth: number,
  expiryYear: number,
  dueAt: string,
): boolean {
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) throw new Error(`Ugyldig forfaldsdato: "${dueAt}"`);
  // Første øjeblik i måneden EFTER udløbsmåneden (UTC).
  const firstInvalid = Date.UTC(expiryYear, expiryMonth, 1);
  return due >= firstInvalid;
}

/** "12. november 2026" — datoen, som kunden ser den, i butikkens tidszone. */
export function formatDanishDate(when: Date, timeZone = SHOP_TIME_ZONE): string {
  return new Intl.DateTimeFormat("da-DK", { timeZone, day: "numeric", month: "long", year: "numeric" }).format(when);
}
