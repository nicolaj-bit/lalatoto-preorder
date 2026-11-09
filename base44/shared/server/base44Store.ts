// Forsøg på træk gemt i Base44-entiteten PreorderCharge.

import type { AttemptStore, ChargeAttempt } from "./chargeJob.ts";
import type { TokenStore } from "./shopify.ts";

/** Base44-SDK'ets entities (asServiceRole.entities). Typet løst, som SDK'et. */
// deno-lint-ignore no-explicit-any
type Entities = any;

function fromRecord(r: any): ChargeAttempt & { id: string } {
  return {
    id: r.id,
    orderId: r.order_id,
    orderName: r.order_name,
    scheduleId: r.schedule_id,
    attempt: r.attempt,
    status: r.status,
    paymentReferenceId: r.payment_reference_id ?? null,
    message: r.message ?? null,
    createdAt: r.attempted_at,
  };
}

function toRecord(a: Partial<ChargeAttempt>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (a.orderId !== undefined) out.order_id = a.orderId;
  if (a.orderName !== undefined) out.order_name = a.orderName;
  if (a.scheduleId !== undefined) out.schedule_id = a.scheduleId;
  if (a.attempt !== undefined) out.attempt = a.attempt;
  if (a.status !== undefined) out.status = a.status;
  if (a.paymentReferenceId !== undefined) out.payment_reference_id = a.paymentReferenceId;
  if (a.message !== undefined) out.message = a.message;
  if (a.createdAt !== undefined) out.attempted_at = a.createdAt;
  return out;
}

export function base44AttemptStore(entities: Entities): AttemptStore {
  return {
    async last(orderId, scheduleId) {
      const rows = await entities.PreorderCharge.filter({ order_id: orderId, schedule_id: scheduleId }, "-attempt", 1);
      return rows[0] ? fromRecord(rows[0]) : null;
    },
    async add(attempt) {
      await entities.PreorderCharge.create(toRecord(attempt));
    },
    async update(id, changes) {
      await entities.PreorderCharge.update(id, toRecord(changes));
    },
  };
}

/** Seneste forsøg pr. ordre, til dashboardet. */
export async function latestAttemptsByOrder(entities: Entities): Promise<Map<string, ChargeAttempt>> {
  const rows = await entities.PreorderCharge.list("-attempted_at", 1000);
  const map = new Map<string, ChargeAttempt>();
  for (const r of rows) if (!map.has(r.order_id)) map.set(r.order_id, fromRecord(r));
  return map;
}

/** Offline-tokenet pr. butik i entiteten ShopAccess. */
export function base44TokenStore(entities: Entities): TokenStore {
  async function latest(shop: string) {
    const rows = await entities.ShopAccess.filter({ shop }, "-obtained_at", 1);
    return rows[0] ?? null;
  }
  return {
    async get(shop) {
      const r = await latest(shop);
      if (!r?.access_token) return null;
      return {
        accessToken: r.access_token,
        scope: r.scope ?? "",
        refreshToken: r.refresh_token ?? null,
        expiresAt: r.expires_at ?? null,
        refreshExpiresAt: r.refresh_expires_at ?? null,
      };
    },
    async set(shop, token) {
      const r = await latest(shop);
      const record = {
        shop,
        access_token: token.accessToken,
        scope: token.scope,
        refresh_token: token.refreshToken ?? null,
        expires_at: token.expiresAt ?? null,
        refresh_expires_at: token.refreshExpiresAt ?? null,
        obtained_at: new Date().toISOString(),
      };
      if (r) await entities.ShopAccess.update(r.id, record);
      else await entities.ShopAccess.create(record);
    },
    async clear(shop) {
      const rows = await entities.ShopAccess.filter({ shop });
      for (const r of rows) await entities.ShopAccess.delete(r.id);
    },
  };
}
