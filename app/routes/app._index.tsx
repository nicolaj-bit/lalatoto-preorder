// Dashboardet: hvilke produkter kan forudbestilles, hvornår trækkes
// restbeløbet, og tilføj eller fjern en forudbestilling.

import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  EmptyState,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  ResourceItem,
  ResourceList,
  Text,
  TextField,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { graphqlFromAdmin } from "../lib/shopify/remixGraphql.server";
import { createPreorder, listPreorders, removePreorder } from "../lib/preorder/catalog";
import { formatDanishDate } from "../lib/preorder/dates";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const preorders = await listPreorders(graphqlFromAdmin(admin));
  return {
    preorders: preorders.map((p) => ({
      ...p,
      chargeDateText: p.chargeAt ? formatDanishDate(new Date(p.chargeAt)) : "ukendt dato",
    })),
  };
};

type ActionResult = { ok: true; message: string } | { ok: false; message: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin } = await authenticate.admin(request);
  const graphql = graphqlFromAdmin(admin);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const deposit = Number(form.get("depositPercent") ?? 0);
    if (!Number.isInteger(deposit) || deposit < 0 || deposit > 99) {
      return { ok: false, message: "Depositum skal være et helt tal fra 0 til 99 %" };
    }
    const result = await createPreorder(graphql, {
      productId: String(form.get("productId") ?? ""),
      chargeDate: String(form.get("chargeDate") ?? ""),
      depositPercent: deposit,
    });
    return result.ok
      ? { ok: true, message: `Forudbestilling oprettet. Restbeløbet trækkes ${formatDanishDate(new Date(result.chargeAt))}.` }
      : result;
  }

  if (intent === "remove") {
    const productIds = JSON.parse(String(form.get("productIds") ?? "[]")) as string[];
    const result = await removePreorder(graphql, { groupId: String(form.get("groupId") ?? ""), productIds });
    return result.ok ? { ok: true, message: "Forudbestillingen er fjernet. Lagte ordrer er ikke ændret." } : result;
  }

  return { ok: false, message: "Ukendt handling" };
};

export default function Index() {
  const { preorders } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const busy = navigation.state !== "idle";

  const [product, setProduct] = useState<{ id: string; title: string } | null>(null);
  const [chargeDate, setChargeDate] = useState("");
  const [deposit, setDeposit] = useState("0");

  useEffect(() => {
    if (result?.ok) {
      shopify.toast.show(result.message);
      setProduct(null);
      setChargeDate("");
    }
  }, [result, shopify]);

  async function pickProduct() {
    const selection = await shopify.resourcePicker({ type: "product", multiple: false, action: "select" });
    const picked = selection?.[0];
    if (picked) setProduct({ id: picked.id, title: picked.title });
  }

  return (
    <Page title="Forudbestillinger">
      <Layout>
        {result && !result.ok && (
          <Layout.Section>
            <Banner tone="critical" title="Det gik ikke">
              <p>{result.message}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Tilføj forudbestilling
              </Text>
              <Text as="p" tone="subdued">
                Kunden betaler depositummet ved køb. Resten trækkes automatisk kl. 9 på datoen, og varen sendes
                tidligst samme dag. Produktet kan derefter kun købes som forudbestilling.
              </Text>
              <Form method="post">
                <input type="hidden" name="intent" value="create" />
                <input type="hidden" name="productId" value={product?.id ?? ""} />
                <FormLayout>
                  <InlineStack gap="300" blockAlign="center">
                    <Button onClick={pickProduct}>{product ? "Vælg et andet produkt" : "Vælg produkt"}</Button>
                    <Text as="span">{product ? product.title : "Intet produkt valgt"}</Text>
                  </InlineStack>
                  <FormLayout.Group>
                    <TextField
                      label="Dato for restbeløb og afsendelse"
                      type="date"
                      name="chargeDate"
                      value={chargeDate}
                      onChange={setChargeDate}
                      autoComplete="off"
                    />
                    <TextField
                      label="Depositum ved køb"
                      type="number"
                      name="depositPercent"
                      suffix="%"
                      min={0}
                      max={99}
                      value={deposit}
                      onChange={setDeposit}
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <Button submit variant="primary" loading={busy} disabled={!product || !chargeDate}>
                    Opret forudbestilling
                  </Button>
                </FormLayout>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            {preorders.length === 0 ? (
              <EmptyState heading="Ingen forudbestillinger endnu" image="">
                <p>Vælg et produkt ovenfor for at åbne for forudbestilling.</p>
              </EmptyState>
            ) : (
              <ResourceList
                resourceName={{ singular: "forudbestilling", plural: "forudbestillinger" }}
                items={preorders}
                renderItem={(p) => (
                  <ResourceItem id={p.groupId} onClick={() => undefined} accessibilityLabel={`Forudbestilling ${p.groupId}`}>
                    <InlineStack align="space-between" blockAlign="center" gap="400" wrap={false}>
                      <BlockStack gap="100">
                        <Text as="h3" variant="bodyMd" fontWeight="semibold">
                          {p.products.map((x) => x.title).join(", ") || "Intet produkt"}
                        </Text>
                        <Text as="p" tone="subdued">
                          {p.depositPercent ?? "?"} % ved køb · resten {p.chargeDateText}
                          {p.products.some((x) => !x.requiresSellingPlan) && " · kan også købes uden forudbestilling"}
                        </Text>
                      </BlockStack>
                      <Form method="post">
                        <input type="hidden" name="intent" value="remove" />
                        <input type="hidden" name="groupId" value={p.groupId} />
                        <input type="hidden" name="productIds" value={JSON.stringify(p.products.map((x) => x.id))} />
                        <Button submit tone="critical" variant="plain" disabled={busy}>
                          Fjern
                        </Button>
                      </Form>
                    </InlineStack>
                  </ResourceItem>
                )}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
