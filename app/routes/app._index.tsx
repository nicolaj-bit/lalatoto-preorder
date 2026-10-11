import type { LoaderFunctionArgs } from "@remix-run/node";
import { Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

// Bevidst ingen brugerflade i dette trin. Beviset køres med scripts/bevis.ts.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  return (
    <Page title="Lalatoto forudbestilling">
      <Text as="p">Ingen brugerflade endnu. Se README.md.</Text>
    </Page>
  );
}
