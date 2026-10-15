// GraphQL, som kun Base44-funktionerne bruger.

/**
 * Ordrer med udskudt betaling. Admin API'et kan ikke søge på selling plan,
 * så funktionerne henter de nyeste ordrer og filtrerer selv.
 * read_orders + read_all_orders + read_payment_terms (+ read_customers).
 */
export const PREORDER_CANDIDATES_QUERY = /* GraphQL */ `
  query ForudbestillingsOrdrer($after: String, $query: String) {
    orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        lineItems(first: 20) { nodes { sellingPlan { sellingPlanId } } }
        paymentTerms { id paymentSchedules(first: 5) { nodes { id dueAt completedAt } } }
      }
    }
  }
`;

/** Til dashboardet: kunde, varer og betaling. Ingen kortoplysninger. */
export const DASHBOARD_ORDERS_QUERY = /* GraphQL */ `
  query DashboardOrdrer($after: String) {
    orders(first: 50, after: $after, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        totalReceivedSet { shopMoney { amount currencyCode } }
        totalOutstandingSet { shopMoney { amount currencyCode } }
        customer { id displayName email phone }
        shippingAddress { name address1 address2 zip city country phone }
        lineItems(first: 20) { nodes { title quantity sellingPlan { sellingPlanId name } } }
        paymentTerms { paymentSchedules(first: 5) { nodes { id dueAt completedAt balanceDue { amount currencyCode } } } }
      }
    }
  }
`;
