// Fanen «Kilder» i dashboardet: hvor mange ordrer der har svaret hvad på
// «Hvor hørte du om os første gang?» (se orderSourceHandler.ts).
//
// Tallene tælles af Shopify (ordersCount) pr. tag, så alle ordrer er med,
// ikke kun forudbestillinger. «Andet»-svarene hentes med kundens egen tekst.

import type { Graphql } from "../preorder/cancelService.ts";
import { SOURCE_TAG_PREFIX, SOURCES, type Source } from "./orderSourceHandler.ts";

export type SourceStats = {
  /** Antal dage tilbage, eller null for alle ordrer. */
  days: number | null;
  /** Ordrer i perioden i alt, så svarprocenten kan vises. */
  orders: number;
  /** Ordrer med et svar. */
  answered: number;
  counts: { source: Source; count: number }[];
  /** De seneste svar under «Andet» med kundens egen tekst. */
  other: { orderId: string; orderName: string; createdAt: string; text: string | null }[];
};

/** Perioderne, dashboardet kan vælge imellem. 0 betyder alle. */
export const SOURCE_PERIODS = [30, 90, 365, 0] as const;

/** Datoen som YYYY-MM-DD, `days` dage før `now` (i UTC; Shopify søger på dato). */
function sinceDate(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export async function sourceStats(graphql: Graphql, opts: { days: number; now?: Date }): Promise<SourceStats> {
  const days = SOURCE_PERIODS.includes(opts.days as (typeof SOURCE_PERIODS)[number]) ? opts.days : 90;
  const since = days > 0 ? ` created_at:>=${sinceDate(days, opts.now ?? new Date())}` : "";

  // Én forespørgsel med et alias pr. svar. Tagget citeres, fordi det har bindestreger.
  const countFields = SOURCES.map(
    (s, i) => `s${i}: ordersCount(query: "tag:'${SOURCE_TAG_PREFIX}${s}'${since}", limit: null) { count }`,
  ).join("\n    ");
  const query = `query KildeTal {
    total: ordersCount(query: "${since.trim()}", limit: null) { count }
    ${countFields}
    other: orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "tag:'${SOURCE_TAG_PREFIX}andet'${since}") {
      nodes { id name createdAt kilde: metafield(namespace: "lalatoto", key: "kilde") { value } }
    }
  }`;

  const data = await graphql(query);
  const counts = SOURCES.map((source, i) => ({ source, count: Number(data?.[`s${i}`]?.count ?? 0) }));
  return {
    days: days > 0 ? days : null,
    orders: Number(data?.total?.count ?? 0),
    answered: counts.reduce((sum, c) => sum + c.count, 0),
    counts,
    other: (data?.other?.nodes ?? []).map((n: any) => ({
      orderId: n.id,
      orderName: n.name,
      createdAt: n.createdAt,
      text: n.kilde?.value ?? null,
    })),
  };
}
