// Kundesegment pr. produkt til Shopify Email (dashboardets knap «Opret segment»).
//
// products_purchased tæller alle ordrer med produktet, også forudbestillinger,
// der ikke er betalt endnu (afprøvet på felt-post 2026-10-18). Findes et
// segment med samme navn, genbruges det i stedet for at fejle.

import type { Graphql } from "../preorder/cancelService.ts";

export function productNumericId(productId: string): string | null {
  const m = /^gid:\/\/shopify\/Product\/(\d+)$/.exec(productId);
  return m ? m[1] : null;
}

export function segmentName(productTitle: string): string {
  return `Forudbestilt: ${productTitle}`.slice(0, 255);
}

const SEGMENT_CREATE = /* GraphQL */ `
  mutation OpretSegment($name: String!, $query: String!) {
    segmentCreate(name: $name, query: $query) {
      segment { id name query }
      userErrors { field message }
    }
  }
`;

const SEGMENTS_BY_NAME = /* GraphQL */ `
  query FindSegment($query: String!) {
    segments(first: 10, query: $query) { nodes { id name query } }
  }
`;

export type SegmentResult =
  | { ok: true; id: string; name: string; existed: boolean }
  | { ok: false; error: string };

export async function createProductSegment(
  graphql: Graphql,
  productId: string,
  productTitle: string,
): Promise<SegmentResult> {
  const numeric = productNumericId(productId);
  if (!numeric) return { ok: false, error: "Ugyldigt produkt" };
  const name = segmentName(productTitle);
  const query = `products_purchased(id: ${numeric}) = true`;

  const data: any = await graphql(SEGMENT_CREATE, { name, query });
  const created = data.segmentCreate;
  if (created.segment) return { ok: true, id: created.segment.id, name: created.segment.name, existed: false };

  // Navnet er taget: brug det eksisterende segment, hvis det er det samme.
  const found: any = await graphql(SEGMENTS_BY_NAME, { query: `name:"${name.replace(/"/g, "")}"` });
  const same = found.segments.nodes.find((s: any) => s.name === name);
  if (same) return { ok: true, id: same.id, name: same.name, existed: true };
  return { ok: false, error: created.userErrors.map((e: any) => e.message).join("; ") || "Kunne ikke oprette segmentet" };
}
