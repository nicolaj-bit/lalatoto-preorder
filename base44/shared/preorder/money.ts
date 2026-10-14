// KOPI — genereret af scripts/base44-sync.ts. Ret i app/lib, ikke her.
// Beløb regnes i hele øre (heltal), aldrig i kommatal.
// 0,1 + 0,2 er ikke 0,3 i JavaScript, og en øre forkert på en kundes kort er
// en reklamation. Shopify sender beløb som decimal-strenge, fx "499.00".

export type Money = { amount: string; currencyCode: string };

/** "499.5" → 49950. Afviser alt, der ikke er et ikke-negativt beløb med højst to decimaler. */
export function toMinor(amount: string): number {
  const trimmed = amount.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`Ugyldigt beløb: "${amount}"`);
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const minor = whole * 100 + fraction;
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Beløbet er for stort: "${amount}"`);
  }
  return minor;
}

/** 49950 → "499.50" (formatet Shopify forventer i MoneyInput). */
export function fromMinor(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error(`Ugyldigt øre-beløb: ${minor}`);
  }
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

/**
 * Deler en pris i det, der betales ved checkout, og det, der udskydes.
 *
 * Depositum rundes NED til hel øre, så kunden aldrig betaler mere nu end
 * procentsatsen siger; resten havner i restbeløbet. Shopifys egen afrunding
 * af procent-depositum er ikke dokumenteret — det her er vores regel, og
 * integrationstesten skal bekræfte, at den matcher det, Shopify gør.
 */
export function splitCheckoutCharge(
  totalMinor: number,
  depositPercent: number,
): { dueNowMinor: number; dueLaterMinor: number } {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new Error(`Ugyldig total: ${totalMinor}`);
  }
  assertPercent(depositPercent);
  // Regnes i hundrededele procent som heltal for at undgå kommatalsfejl.
  const basisPoints = Math.round(depositPercent * 100);
  const dueNowMinor = Math.floor((totalMinor * basisPoints) / 10_000);
  return { dueNowMinor, dueLaterMinor: totalMinor - dueNowMinor };
}

export function assertPercent(percent: number): void {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`Procentsats skal være mellem 0 og 100, fik ${percent}`);
  }
}
