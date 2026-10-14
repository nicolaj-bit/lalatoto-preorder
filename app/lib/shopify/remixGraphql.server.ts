// Gør Remix-skabelonens admin-klient til samme simple Graphql-funktion, som
// scripts og tests bruger, så logikken i app/lib/preorder er den samme overalt.

import type { Graphql } from "../preorder/cancelService";

type AdminLike = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export function graphqlFromAdmin(admin: AdminLike): Graphql {
  return async (query, variables) => {
    const res = await admin.graphql(query, { variables });
    const body = (await res.json()) as { data?: any; errors?: unknown };
    if (body.errors) throw new Error(`GraphQL-fejl: ${JSON.stringify(body.errors)}`);
    return body.data;
  };
}
