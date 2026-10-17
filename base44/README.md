# Base44-appen «Lalatoto Forudbestilling»

Serveren for forudbestillingerne. **Kilden er her**, hvor koden er testet.
Base44-appen ligger i repoet `nicolaj-bit/lalatoto-dashboard`; kopiér
derover med:

```shell
npm run base44:sync -- --to ../lalatoto-dashboard
```

| Sti | Indhold |
|---|---|
| `functions/cancelPreorder/` | Kaldes af knappen «Annuller forudbestilling» i kundekontoen. Uden Base44-login; kunden godkendes med kundekontoens session token |
| `functions/chargeDuePreorders/` | Trækker restbeløbet på forfaldne forudbestillinger. `{ dryRun: true }` viser kun, hvad der ville blive trukket |
| `functions/remindUpcomingPreorders/` | Sender én mail til appens admin-brugere om de forudbestillinger, der forfalder om 7 dage. `{ dryRun: true }` viser mailen uden at sende |
| `functions/listPreorders/` | Base44-dashboardets liste over forudbestillinger og kunder. Kun for admin |
| `functions/adminPreorders/` | Samme liste og prøvekørslen af trækket til dashboardet inde i Shopify admin (`admin-app/`). Uden Base44-login; godkendes med App Bridges ID token |
| `workflows/Daglig træk af restbeløb.jsonc` | Kalder `chargeDuePreorders` hver dag kl. 9.15 dansk tid |
| `workflows/Påmindelse før forfald.jsonc` | Kalder `remindUpcomingPreorders` hver dag kl. 8 dansk tid |
| `entities/PreorderCharge.jsonc` | Hvert forsøg på at trække restbeløbet |
| `entities/PreorderCancellation.jsonc` | Hver kundeannullering |
| `frontend/pages/Forudbestillinger.jsx` | Dashboardet. Kopieres til `src/pages/` i Base44-appen |
| `shared/preorder/` | **Kopi** af `app/lib` — ret aldrig her, kør `npm run base44:sync` |
| `shared/server/` | Kode, kun funktionerne bruger: Shopify-adgang, session token, trækket, dashboardets data |

**Nye workflows skal registreres i Base44.** Base44 henter workflow-filen
med GitHub-synkroniseringen, men opretter ikke workflowet ud fra den. Bed
Base44's assistent om at gemme filen uændret, så workflowet bliver oprettet
og aktivt. Nye funktioner kommer med synkroniseringen af sig selv.

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
