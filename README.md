# lalatoto-preorder

Custom Shopify-app til forudbestilling med udskudt betaling (*deferred
purchase options*). Bygget på Shopifys officielle Remix-skabelon.

**Dette trin er kun et bevis.** Der er ingen brugerflade, ingen app blocks og
intet design. Beviset viser, at vi kan sælge en vare med 0 kr. ved checkout
og trække restbeløbet senere via API'et.

Læs først [`docs/forudsaetninger.md`](docs/forudsaetninger.md): krav, kilder,
hvad Shopify opretter, og hvad der sker, når noget går galt.

---

## Hvad ligger hvor

| Sti | Indhold |
|---|---|
| `app/lib/preorder/` | Logikken: beløb i øre, datoer i dansk tid, selling plan, beslutning om træk |
| `app/lib/shopify/` | GraphQL-kald og en lille Admin API-klient til scripts |
| `scripts/bevis.ts` | Beviset, trin for trin mod udviklingsbutikken |
| `tests/unit/` | Enhedstests — kører uden netværk |
| `tests/integration/` | Integrationstest mod udviklingsbutikken |
| `app/routes/`, `prisma/` | Fra skabelonen: login, sessions og webhooks |

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
3. `shopify app deploy` — sender scopes og webhooks til Shopify.
   - `read_payment_mandate`/`write_payment_mandate` står ikke i
     `shopify.app.toml`, fordi Shopify afviser appen med dem, indtil de er
     godkendt. Uden dem kan beviset oprette plan og ordre, men ikke trække
     restbeløbet. Se `docs/forudsaetninger.md` afsnit 1.2.
4. `shopify app dev` og installér appen på udviklingsbutikken, når CLI'en
   viser linket.

Senere på en rigtig butik: vælg *Custom distribution* for appen i Dev
Dashboard og send installationslinket til butikken. Det er ikke en del af
dette trin.

---

## Kør beviset

```shell
export SHOPIFY_STORE=lalatoto-preorder-dev.myshopify.com
export SHOPIFY_API_KEY=…      # fra Dev Dashboard → App settings
export SHOPIFY_API_SECRET=…

npm run bevis -- opret --dato 2026-12-01      # produkt + forudbestillingsplan
# … læg testordren i butikken (scriptet skriver hvordan) …
npm run bevis -- vis --ordre <ordre-id>       # betalingsaftale og forfaldsdato
npm run bevis -- traek --ordre <ordre-id> --foer-tid   # træk restbeløbet nu
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
