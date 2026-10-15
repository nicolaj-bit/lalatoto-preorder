# Base44-appen «Lalatoto Forudbestilling»

Serveren for forudbestillingerne. Den flyttes over i Base44-appens eget
GitHub-repo, når appen er koblet til GitHub. Indtil da ligger den her.

| Sti | Indhold |
|---|---|
| `functions/cancelPreorder/` | Kaldes af knappen «Annuller forudbestilling» i kundekontoen. Uden Base44-login; kunden godkendes med kundekontoens session token |
| `functions/chargeDuePreorders/` | Trækker restbeløbet på forfaldne forudbestillinger. `{ dryRun: true }` viser kun, hvad der ville blive trukket |
| `functions/listPreorders/` | Dashboardets liste over forudbestillinger og kunder. Kun for admin |
| `workflows/Daglig træk af restbeløb.jsonc` | Kalder `chargeDuePreorders` hver dag kl. 9.15 dansk tid |
| `entities/PreorderCharge.jsonc` | Hvert forsøg på at trække restbeløbet |
| `entities/PreorderCancellation.jsonc` | Hver kundeannullering |
| `frontend/pages/Forudbestillinger.jsx` | Dashboardet. Flyttes til `src/pages/` i Base44-appen |
| `shared/preorder/` | **Kopi** af `app/lib` — ret aldrig her, kør `npm run base44:sync` |
| `shared/server/` | Kode, kun funktionerne bruger: Shopify-adgang, session token, trækket, dashboardets data |

## Hemmeligheder i Base44

| Navn | Værdi |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | fx `felt-post.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Appens Client ID fra Dev Dashboard |
| `SHOPIFY_CLIENT_SECRET` | Appens Client secret fra Dev Dashboard |

Funktionerne henter selv et token med client credentials grant. Det virker
kun, når Shopify-appen og butikken ligger i samme organisation.

## Det, der ikke er afprøvet i Base44 endnu

- **Om en Base44-funktion svarer på browserens forhåndsforespørgsel**
  (`OPTIONS`) fra kundekontoen. Funktionen svarer selv med CORS-headers,
  men Base44 skal sende `OPTIONS` videre til den. Afprøves med:
  `curl -i -X OPTIONS <funktionens adresse>`.
- **Om Base44 kræver `X-App-Id`** fra et kald uden login. Knappen sender den.
- Kørt mod felt-post med Deno her: dashboardets data og en prøvekørsel af
  trækket. Selve trækket og annulleringen er kun kørt mod et falsk Shopify
  i testene (`tests/unit/base44*.test.ts`).
