// Påmindelse til admin før den forventede dato (Base44-funktionen remindUpcomingPreorders,
// kørt dagligt af et planlagt workflow).
//
// Finder de forudbestillinger, hvis restbeløb forfalder om REMINDER_DAYS_AHEAD
// dage, og bygger én samlet mail. Der sammenlignes på kalenderdag i dansk tid,
// så hver ordre kommer med præcis én gang — også hvis datoen er blevet flyttet.

import type { Graphql } from "../preorder/cancelService.ts";
import { formatDanishDate, SHOP_TIME_ZONE } from "../preorder/dates.ts";
import { listPreorderRows, type PreorderRow } from "./dashboard.ts";

export const REMINDER_DAYS_AHEAD = 7;
const DAY_MS = 86_400_000;

/** «ÅÅÅÅ-MM-DD» for tidspunktet i dansk tid. */
export function danishDayKey(when: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SHOP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);
}

/** Ubetalte forudbestillinger, der forfalder på dagen om `days` dage. */
export function rowsDueIn(rows: PreorderRow[], now: Date, days: number): PreorderRow[] {
  const target = danishDayKey(new Date(now.getTime() + days * DAY_MS));
  return rows.filter((r) => r.status === "afventer betaling" && r.dueAt && danishDayKey(new Date(r.dueAt)) === target);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type ReminderEmail = { subject: string; body: string };

/** Én mail med alle ordrerne, eller null, når der ingen er. */
export function reminderEmail(rows: PreorderRow[], days: number): ReminderEmail | null {
  if (rows.length === 0) return null;
  const dueText = formatDanishDate(new Date(rows[0].dueAt!));
  const total = rows.reduce((sum, r) => sum + Number(r.outstanding), 0).toFixed(2);
  const currency = rows[0].currency;
  const subject =
    rows.length === 1
      ? `Forudbestilling ${rows[0].orderNumber} forfalder ${dueText}`
      : `${rows.length} forudbestillinger forfalder ${dueText}`;
  const items = rows
    .map((r) => {
      const who = r.customer.name ?? r.customer.email ?? "ukendt kunde";
      return `<li><a href="${escapeHtml(r.adminUrl)}">${escapeHtml(r.orderNumber)}</a> · ${escapeHtml(who)} · ${escapeHtml(
        r.items.join(", "),
      )} · ${escapeHtml(r.outstanding)} ${escapeHtml(r.currency)}</li>`;
    })
    .join("");
  const body = [
    `<p>Om ${days} dage, ${escapeHtml(dueText)}, er den forventede dato for ${
      rows.length === 1 ? "denne forudbestilling" : `disse ${rows.length} forudbestillinger`
    }. Restbeløbet er i alt ${total} ${escapeHtml(currency)}:</p>`,
    `<ul>${items}</ul>`,
    `<p>Restbeløbet trækkes ikke af sig selv. Når varen er kommet hjem, så tryk «Træk alle» ved produktet i appen Lalatoto Forudbestilling i Shopify admin. Er leveringen forsinket, så ret datoen i blokken «Forudbestilling» på produktet, så kunderne får besked.</p>`,
  ].join("");
  return { subject, body };
}

export async function runReminderJob(deps: {
  graphql: Graphql;
  store: string;
  now?: Date;
  days?: number;
}): Promise<{ rows: PreorderRow[]; email: ReminderEmail | null }> {
  const now = deps.now ?? new Date();
  const days = deps.days ?? REMINDER_DAYS_AHEAD;
  const rows = rowsDueIn(await listPreorderRows(deps.graphql, { store: deps.store, now }), now, days);
  return { rows, email: reminderEmail(rows, days) };
}
