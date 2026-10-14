// Alle GraphQL-kald i beviset. Valideret mod Admin API-skemaet 2026-04.
// Scopes står ud for hvert kald, så det er let at se, hvad der kræver
// Shopifys godkendelse (markeret ⚠).

/** read_products (plan) — bruges til at nægte at køre mod en rigtig butik. */
export const SHOP_QUERY = /* GraphQL */ `
  query Butik {
    shop {
      name
      myshopifyDomain
      currencyCode
      plan { partnerDevelopment shopifyPlus publicDisplayName }
    }
  }
`;

/** write_products + write_purchase_options */
export const SELLING_PLAN_GROUP_CREATE = /* GraphQL */ `
  mutation OpretForudbestillingsplan($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
    sellingPlanGroupCreate(input: $input, resources: $resources) {
      sellingPlanGroup {
        id
        name
        merchantCode
        sellingPlans(first: 5) {
          nodes {
            id
            name
            category
            billingPolicy {
              ... on SellingPlanFixedBillingPolicy {
                checkoutCharge {
                  type
                  value {
                    ... on SellingPlanCheckoutChargePercentageValue { percentage }
                    ... on MoneyV2 { amount currencyCode }
                  }
                }
                remainingBalanceChargeTrigger
                remainingBalanceChargeExactTime
                remainingBalanceChargeTimeAfterCheckout
              }
            }
            deliveryPolicy {
              ... on SellingPlanFixedDeliveryPolicy { fulfillmentTrigger fulfillmentExactTime preAnchorBehavior }
            }
            inventoryPolicy { reserve }
          }
        }
      }
      userErrors { field message code }
    }
  }
`;

/** write_products */
export const PRODUCT_SET = /* GraphQL */ `
  mutation OpretTestprodukt($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product { id title handle status variants(first: 1) { nodes { id price } } }
      userErrors { field message code }
    }
  }
`;

/** read_publications */
export const PUBLICATIONS_QUERY = /* GraphQL */ `
  query Salgskanaler {
    publications(first: 20) { nodes { id name catalog { title } } }
  }
`;

/** write_publications */
export const PUBLISHABLE_PUBLISH = /* GraphQL */ `
  mutation Udgiv($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) { userErrors { field message } }
  }
`;

/**
 * read_orders + read_payment_terms + ⚠ read_payment_mandate (+ read_customers for customer).
 * Med `medMandat: false` udelades det gemte betalingsmiddel, så ordren kan læses
 * uden read_payment_mandate.
 */
export const ORDER_QUERY = /* GraphQL */ `
  query Ordre($id: ID!, $medMandat: Boolean = true) {
    order(id: $id) {
      id
      name
      createdAt
      cancelledAt
      cancelReason
      displayFinancialStatus
      displayFulfillmentStatus
      currencyCode
      test
      totalPriceSet { shopMoney { amount currencyCode } }
      totalReceivedSet { shopMoney { amount currencyCode } }
      totalOutstandingSet { shopMoney { amount currencyCode } }
      paymentGatewayNames
      lineItems(first: 10) {
        nodes {
          id
          title
          quantity
          sellingPlan { sellingPlanId name }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        }
      }
      paymentTerms {
        id
        paymentTermsName
        paymentTermsType
        dueInDays
        due
        overdue
        paymentSchedules(first: 5) {
          nodes {
            id
            dueAt
            issuedAt
            completedAt
            due
            balanceDue { amount currencyCode }
            totalBalance { amount currencyCode }
          }
        }
      }
      paymentCollectionDetails {
        additionalPaymentCollectionUrl
        vaultedPaymentMethods @include(if: $medMandat) {
          id
          paymentInstrument {
            __typename
            ... on VaultCreditCard { brand lastDigits expiryMonth expiryYear expired name }
            ... on VaultPaypalBillingAgreement { name paypalAccountEmail inactive }
          }
        }
      }
      transactions(first: 20) {
        id
        kind
        status
        gateway
        test
        errorCode
        createdAt
        paymentId
        amountSet { shopMoney { amount currencyCode } }
      }
    }
  }
`;

/** ⚠ write_payment_mandate */
export const ORDER_CREATE_MANDATE_PAYMENT = /* GraphQL */ `
  mutation TraekRestbeloeb(
    $id: ID!
    $mandateId: ID!
    $paymentScheduleId: ID
    $idempotencyKey: String!
    $amount: MoneyInput
    $autoCapture: Boolean
  ) {
    orderCreateMandatePayment(
      id: $id
      mandateId: $mandateId
      paymentScheduleId: $paymentScheduleId
      idempotencyKey: $idempotencyKey
      amount: $amount
      autoCapture: $autoCapture
    ) {
      job { id done }
      paymentReferenceId
      userErrors { field message code }
    }
  }
`;

/** read_orders */
export const ORDER_PAYMENT_STATUS = /* GraphQL */ `
  query Betalingsstatus($orderId: ID!, $paymentReferenceId: String!) {
    orderPaymentStatus(orderId: $orderId, paymentReferenceId: $paymentReferenceId) {
      status
      errorMessage
      translatedErrorMessage
      paymentReferenceId
      transactions {
        id
        kind
        status
        errorCode
        amountSet { shopMoney { amount currencyCode } }
      }
    }
  }
`;

/** write_orders */
export const ORDER_CANCEL = /* GraphQL */ `
  mutation AnnullerOrdre(
    $orderId: ID!
    $reason: OrderCancelReason!
    $restock: Boolean!
    $notifyCustomer: Boolean
    $staffNote: String
    $refundMethod: OrderCancelRefundMethodInput
  ) {
    orderCancel(
      orderId: $orderId
      reason: $reason
      restock: $restock
      notifyCustomer: $notifyCustomer
      staffNote: $staffNote
      refundMethod: $refundMethod
    ) {
      job { id done }
      orderCancelUserErrors { field message code }
    }
  }
`;

/** write_products + write_purchase_options */
export const CLEANUP = /* GraphQL */ `
  mutation Ryd($groupId: ID!, $productId: ID!) {
    sellingPlanGroupDelete(id: $groupId) { deletedSellingPlanGroupId userErrors { field message } }
    productDelete(input: { id: $productId }) { deletedProductId userErrors { field message } }
  }
`;

/** read_orders + read_customers. Det, decideCancel skal bruge. */
export const CANCEL_ORDER_QUERY = /* GraphQL */ `
  query OrdreTilAnnullering($id: ID!) {
    order(id: $id) {
      id
      name
      cancelledAt
      displayFulfillmentStatus
      customer { id }
      totalReceivedSet { shopMoney { amount currencyCode } }
      paymentTerms { id }
      lineItems(first: 50) { nodes { sellingPlan { sellingPlanId } } }
    }
  }
`;

/** read_purchase_options. Linjen kender kun planens id, ikke om det er en forudbestilling. */
export const SELLING_PLAN_CATEGORIES = /* GraphQL */ `
  query PlanKategorier($ids: [ID!]!) {
    nodes(ids: $ids) { ... on SellingPlan { id category } }
  }
`;

/** read_products + read_purchase_options. Alle grupper; appen filtrerer sine egne fra. */
export const PREORDER_GROUPS_QUERY = /* GraphQL */ `
  query Forudbestillinger {
    sellingPlanGroups(first: 50) {
      nodes {
        id
        name
        appId
        merchantCode
        products(first: 20) { nodes { id title handle requiresSellingPlan } }
        sellingPlans(first: 5) {
          nodes {
            id
            category
            billingPolicy {
              ... on SellingPlanFixedBillingPolicy {
                checkoutCharge {
                  type
                  value { ... on SellingPlanCheckoutChargePercentageValue { percentage } }
                }
                remainingBalanceChargeExactTime
              }
            }
          }
        }
      }
    }
  }
`;

/** write_products. Tvinger forudbestillingsplanen og gemmer datoen til temablokken. */
export const PREORDER_PRODUCT_UPDATE = /* GraphQL */ `
  mutation ForudbestillingPaaProdukt($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id requiresSellingPlan }
      userErrors { field message }
    }
  }
`;

export const METAFIELDS_SET = /* GraphQL */ `
  mutation GemMetafelter($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message code }
    }
  }
`;

export const METAFIELDS_DELETE = /* GraphQL */ `
  mutation SletMetafelter($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key namespace ownerId }
      userErrors { field message }
    }
  }
`;

export const SELLING_PLAN_GROUP_DELETE = /* GraphQL */ `
  mutation SletForudbestillingsplan($id: ID!) {
    sellingPlanGroupDelete(id: $id) { deletedSellingPlanGroupId userErrors { field message } }
  }
`;

/** Butikkens id (til shop-metafelter) og den gemte stil. */
export const SHOP_STYLE_QUERY = /* GraphQL */ `
  query ButikStil {
    shop { id metafield(namespace: "lalatoto_preorder", key: "style") { value } }
  }
`;
