# lalatoto-preorder

Custom Shopify-app til forudbestilling med udskudt betaling (*deferred
purchase options*). Bygget på Shopifys officielle Remix-skabelon.

Beviset (`scripts/bevis.ts`) viste, at vi kan sælge en vare med 0 kr. ved
checkout og trække restbeløbet senere via API'et. Oven på det er der nu:

- **Blok på produktet i Shopify admin:** slå forudbestilling til og fra med
  dato og depositum.
- **Temablok på produktsiden:** viser forudbestillingen og lægger varen i
  kurven med planen. Stil og tekster sættes i temaredigeringen: følg temaet
  eller egne farver.
- **Annullering i kundekontoen:** kunden kan selv annullere og får pengene
  tilbage, hvis der er trukket noget.

Alt det ovenfor ligger hos Shopify. **Serveren er en Base44-app**
(Lalatoto Forudbestilling, ikke Club No Sleep). Den skal stå for
annulleringen, det automatiske træk på forfaldsdatoen og et dashboard med
kunderne. Base44-delen er ikke bygget endnu, og det er besked ved
forsinkelse heller ikke.

Læs først [`docs/forudsaetninger.md`](docs/forudsaetninger.md): krav, kilder,
hvad Shopify opretter, og hvad der sker, når noget går galt.

---

## Hvad ligger hvor

| Sti | Indhold |
|---|---|
| `app/lib/preorder/` | Logikken: beløb i øre, datoer i dansk tid, selling plan, beslutning om træk og annullering |
| `app/lib/shopify/` | GraphQL-kald og en lille Admin API-klient til scripts |
| `scripts/bevis.ts` | Beviset, trin for trin mod udviklingsbutikken |
| `tests/unit/` | Enhedstests — kører uden netværk |
| `tests/integration/` | Integrationstest mod udviklingsbutikken |
| `extensions/preorder-produkt/` | Blokken «Forudbestilling» på produktet i admin |
| `extensions/preorder-knap/` | Temablokken «Forudbestilling» til produktsiden |
| `extensions/preorder-annuller/` | Knappen «Annuller forudbestilling» i kundekontoen |
| `app/routes/`, `prisma/` | Fra Remix-skabelonen; bruges ikke, fordi serveren er Base44 |

---

## Kør lokalt

Krav: Node.js 20.19+ eller 22.12+, og Shopify CLI (`npm install -g @shopify/cli@latest`).

```shell
npm install
npm test                 # enhedstests
npm run typecheck
npm run lint
```

Appen startes mod udviklingsbutikken med:

```shell
shopify app dev
```

Første gang beder CLI'en dig logge ind og vælge organisation og
udviklingsbutik. Den skriver selv `client_id` i `shopify.app.toml` og sætter
miljøvariablerne for appen, mens den kører.

---

## Miljøvariabler

Ingen nøgler eller tokens i repoet. `.env` og `.env.*` er i `.gitignore`.

**Appen** (`shopify app dev` sætter dem selv; i drift skal de sættes på serveren):

| Variabel | Hvad |
|---|---|
| `SHOPIFY_API_KEY` | Appens Client ID fra Dev Dashboard |
| `SHOPIFY_API_SECRET` | Appens Client secret fra Dev Dashboard |
| `SHOPIFY_APP_URL` | Den offentlige adresse, appen kører på |
| `SCOPES` | Kommasepareret liste — samme som i `shopify.app.toml` |

**Beviset og integrationstesten** (sættes i din egen terminal):

| Variabel | Hvad |
|---|---|
| `SHOPIFY_STORE` | Udviklingsbutikken, fx `lalatoto-preorder-dev.myshopify.com` |
| `SHOPIFY_API_KEY` | Client ID — bruges til at hente et token (client credentials grant) |
| `SHOPIFY_API_SECRET` | Client secret |
| `SHOPIFY_ADMIN_TOKEN` | Valgfri: et færdigt token i stedet for de to ovenfor |
| `BEVIS_ORDRE_ID` | Valgfri: ordre-id, som integrationstesten også skal tjekke |

Client credentials grant virker kun, når app og butik ligger i samme
organisation i Dev Dashboard. Scripts og test **nægter at køre mod en butik,
der ikke er en udviklingsbutik**, så de kan ikke ramme lalatoto.dk.

---

## Installér på en butik

Appen er en custom app: ingen App Store, intet review.

1. `shopify app init` er allerede gjort — repoet *er* projektet. Kør
   `shopify app config link` og vælg «Create new app» i vores organisation.
2. Opret en udviklingsbutik under *Dev stores* i Dev Dashboard (samme
   organisation). Slå Shopify Payments til i testtilstand under
   *Indstillinger → Betalinger*.
3. **Før deploy på en ny app:** søg `read_all_orders`, abonnements-API'et og
   betalingsaftale-API'et på
   `partners.shopify.com/<organisation>/apps/<app>/api_access`. Siden findes
   ikke i menuen. Uden godkendelse afviser Dev Dashboard versionen med
   «Indeholder ugyldige omfang». Se `docs/forudsaetninger.md` afsnit 1.2.
4. `shopify app deploy` — sender scopes og webhooks til Shopify. Er appen
   allerede installeret, skal butikken godkende de nye scopes i admin under
   *Apps*.
5. `shopify app dev` og installér appen på udviklingsbutikken, når CLI'en
   viser linket.

Senere på en rigtig butik: vælg *Custom distribution* for appen i Dev
Dashboard og send installationslinket til butikken. Det er ikke en del af
dette trin.

---

## Tag det i brug på en butik

1. **Base44:** appen findes (lalatoto-dashboard,
   `https://lala-order-flow.base44.app`), og `BASE44_ORIGIN` og
   `BASE44_APP_ID` i `extensions/preorder-annuller/src/api.js` peger på den.
   Ny Base44-app: funktionerne udsendes først, når de er gemt i Base44 —
   indtil da svarer de 404 «not found or not deployed».
2. `shopify app deploy` — sender udvidelserne og scopes til Shopify.
3. **Partner Dashboard → appen → API-adgang**
   (`partners.shopify.com/<organisation>/apps/<app>/api_access`):
   - «Allow network access in checkout and account UI extensions», så
     knappen i kundekontoen må kalde Base44.
   - «Protected customer data access», så kundekontoen fortæller, hvilken
     kunde der er logget ind. Uden den afvises alle annulleringer.
4. **Produktet:** åbn produktet i admin. Blokken «Forudbestilling» ligger
   nederst (ellers: *⋯ → Tilpas blokke*). Vælg dato og depositum, og tryk
   «Slå forudbestilling til».
5. **Temaet:** *Webshop → Temaer → Tilpas → produktskabelonen → Tilføj
   blok → Apps → Forudbestilling*. Læg den over læg-i-kurv-knappen, og vælg
   stil og tekster i blokkens indstillinger.
6. **Kundekonti:** *Indstillinger → Kundekonti* skal stå til de nye
   kundekonti.

---

## Kør beviset

```shell
export SHOPIFY_STORE=lalatoto-preorder-dev.myshopify.com
export SHOPIFY_API_KEY=…      # fra Dev Dashboard → App settings
export SHOPIFY_API_SECRET=…

npm run bevis -- opret --dato 2026-12-01      # produkt + forudbestillingsplan
# … læg testordren i butikken (scriptet skriver hvordan) …
npm run bevis -- vis --ordre <ordre-id>       # betalingsaftale og forfaldsdato
npm run bevis -- traek --ordre <ordre-id> --foer-tid   # træk restbeløbet nu (--med-beloeb kun på Plus)
npm run bevis -- annuller --ordre <ordre-id>  # til fejltilfældene
npm run bevis -- ryd-op                       # slet produkt og plan igen

npm run test:integration                      # integrationstesten
```

Ordre-id er tallet i admin-URL'en (`/admin/orders/1234567890`), ikke `#1001`.

---

## Om Remix-skabelonen

Skabelonen er Shopifys officielle `shopify-app-template-remix`, som ønsket.
Shopify skriver selv i den, at nye projekter bør bruge React
Router-skabelonen, og Remix-pakken understøtter højst Admin API 2026-04.
Logikken i `app/lib/` og `scripts/` afhænger ikke af Remix og kan flyttes
uændret, hvis vi skifter.
