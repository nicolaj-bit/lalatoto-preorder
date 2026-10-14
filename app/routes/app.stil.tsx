// Stil og tekster til forudbestillingen på produktsiden. Gemmes i
// shop-metafeltet lalatoto_preorder.style og læses af temablokken.

import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  ChoiceList,
  FormLayout,
  InlineGrid,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { graphqlFromAdmin } from "../lib/shopify/remixGraphql.server";
import { METAFIELDS_SET, SHOP_STYLE_QUERY } from "../lib/shopify/operations";
import {
  parseStyleSettings,
  renderInfoText,
  STYLE_KEY,
  STYLE_NAMESPACE,
  validateStyleForm,
  type StyleSettings,
} from "../lib/preorder/style";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const data = await graphqlFromAdmin(admin)<{ shop: { metafield: { value: string } | null } }>(SHOP_STYLE_QUERY);
  return { style: parseStyleSettings(data.shop.metafield?.value ?? null) };
};

type ActionResult = { ok: true } | { ok: false; errors: Partial<Record<string, string>> };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin } = await authenticate.admin(request);
  const graphql = graphqlFromAdmin(admin);
  const form = Object.fromEntries([...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]));
  const result = validateStyleForm(form);
  if (!result.ok) return result;

  const { shop } = await graphql<{ shop: { id: string } }>(SHOP_STYLE_QUERY);
  const saved = await graphql<{ metafieldsSet: { userErrors: Array<{ message: string }> } }>(METAFIELDS_SET, {
    metafields: [
      { ownerId: shop.id, namespace: STYLE_NAMESPACE, key: STYLE_KEY, type: "json", value: JSON.stringify(result.value) },
    ],
  });
  const errors = saved.metafieldsSet.userErrors;
  if (errors.length > 0) return { ok: false, errors: { form: errors.map((e) => e.message).join("; ") } };
  return { ok: true };
};

const COLOR_FIELDS: Array<{ key: keyof StyleSettings["colors"]; label: string }> = [
  { key: "accent", label: "Knap og mærke" },
  { key: "accentText", label: "Tekst på knap og mærke" },
  { key: "background", label: "Baggrund" },
  { key: "text", label: "Tekst" },
];

export default function Stil() {
  const { style } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [s, setS] = useState<StyleSettings>(style);
  const errors = result && !result.ok ? result.errors : {};

  useEffect(() => {
    if (result?.ok) shopify.toast.show("Stilen er gemt");
  }, [result, shopify]);

  const setColor = (key: keyof StyleSettings["colors"]) => (value: string) =>
    setS((prev) => ({ ...prev, colors: { ...prev.colors, [key]: value } }));

  return (
    <Page title="Stil på produktsiden" backAction={{ content: "Forudbestillinger", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Form method="post">
            <input type="hidden" name="mode" value={s.mode} />
            <Card>
              <BlockStack gap="400">
                <ChoiceList
                  title="Stil"
                  choices={[
                    {
                      label: "Følg temaet",
                      value: "theme",
                      helpText: "Bruger butikkens egen skrifttype, farver og knapper. Anbefalet.",
                    },
                    { label: "Egen stil", value: "custom", helpText: "Egne farver og runding ovenpå temaet." },
                  ]}
                  selected={[s.mode]}
                  onChange={([mode]) => setS((prev) => ({ ...prev, mode: mode === "custom" ? "custom" : "theme" }))}
                  error={errors.mode}
                />
                <FormLayout>
                  <TextField
                    label="Tekst på knappen"
                    name="buttonText"
                    value={s.buttonText}
                    onChange={(v) => setS((prev) => ({ ...prev, buttonText: v }))}
                    helpText="Tom = temaets egen tekst, fx «Læg i kurv»."
                    error={errors.buttonText}
                    autoComplete="off"
                  />
                  <TextField
                    label="Mærke"
                    name="badgeText"
                    value={s.badgeText}
                    onChange={(v) => setS((prev) => ({ ...prev, badgeText: v }))}
                    error={errors.badgeText}
                    autoComplete="off"
                  />
                  <TextField
                    label="Tekst til kunden"
                    name="infoText"
                    value={s.infoText}
                    onChange={(v) => setS((prev) => ({ ...prev, infoText: v }))}
                    multiline={2}
                    helpText="{dato} bliver til datoen for restbeløbet, {depositum} til beløbet ved køb."
                    error={errors.infoText}
                    autoComplete="off"
                  />
                </FormLayout>
                {s.mode === "custom" ? (
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                    {COLOR_FIELDS.map(({ key, label }) => (
                      <TextField
                        key={key}
                        label={label}
                        name={key}
                        type="text"
                        value={s.colors[key]}
                        onChange={setColor(key)}
                        prefix={<span style={{ display: "inline-block", width: 16, height: 16, borderRadius: 4, background: s.colors[key], border: "1px solid #ccc" }} />}
                        error={errors[key]}
                        autoComplete="off"
                      />
                    ))}
                    <TextField
                      label="Runding på hjørner"
                      name="radius"
                      type="number"
                      min={0}
                      max={32}
                      suffix="px"
                      value={String(s.radius)}
                      onChange={(v) => setS((prev) => ({ ...prev, radius: Number(v) }))}
                      error={errors.radius}
                      autoComplete="off"
                    />
                  </InlineGrid>
                ) : (
                  // Farverne gemmes alligevel, så de er der, hvis man skifter til egen stil.
                  <>
                    {COLOR_FIELDS.map(({ key }) => (
                      <input key={key} type="hidden" name={key} value={s.colors[key]} />
                    ))}
                    <input type="hidden" name="radius" value={String(s.radius)} />
                  </>
                )}
                {errors.form && <Text as="p" tone="critical">{errors.form}</Text>}
                <InlineGrid columns="auto">
                  <Button submit variant="primary" loading={navigation.state !== "idle"}>
                    Gem
                  </Button>
                </InlineGrid>
              </BlockStack>
            </Card>
          </Form>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Forhåndsvisning
              </Text>
              <Preview style={s} />
              <Text as="p" tone="subdued" variant="bodySm">
                «Følg temaet» vises her med neutrale farver. I butikken får blokken temaets egne.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Preview({ style }: { style: StyleSettings }) {
  const custom = style.mode === "custom";
  const c = style.colors;
  const text = renderInfoText(style.infoText, { dato: "15. december 2026", depositum: "0,00 kr" });
  return (
    <Box>
      <div
        style={{
          padding: 12,
          borderRadius: custom ? style.radius : 8,
          background: custom ? c.background : "#f6f6f7",
          color: custom ? c.text : "inherit",
          border: custom ? "none" : "1px solid #e1e3e5",
        }}
      >
        {style.badgeText && (
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              marginBottom: 6,
              fontSize: 12,
              borderRadius: custom ? style.radius : 4,
              background: custom ? c.accent : "#303030",
              color: custom ? c.accentText : "#fff",
            }}
          >
            {style.badgeText}
          </span>
        )}
        <p style={{ margin: 0 }}>{text}</p>
      </div>
      <div
        style={{
          marginTop: 8,
          padding: "10px 12px",
          textAlign: "center",
          borderRadius: custom ? style.radius : 4,
          background: custom ? c.accent : "#303030",
          color: custom ? c.accentText : "#fff",
        }}
      >
        {style.buttonText || "Læg i kurv"}
      </div>
    </Box>
  );
}
