# Forudsætninger for forudbestilling med udskudt betaling

Det her er den viden, resten af appen bygger på. Alt, der står som fakta,
har et link til Shopifys egen dokumentation. Alt, der ikke kunne findes der,
er markeret **GÆT** eller **UKENDT**.

**Om kilderne:** Hentet 11. oktober 2026 gennem Shopifys officielle
dokumentationssøgning (Shopify Dev MCP, der søger i shopify.dev). Selve
shopify.dev kunne ikke åbnes direkte fra udviklingsmiljøet, og de uddrag,
søgningen returnerer, har ingen «sidst opdateret»-dato. Datoen nedenfor er
derfor den dato, vi læste siden — ikke Shopifys dato. GraphQL-kaldene er
valideret mod Admin API-skemaet samme dag.

Admin API-version i hele projektet: **2026-04**.

---

## Status

| Trin | Status |
|---|---|
| Krav undersøgt (afsnit 1) | ✅ Færdig |
| App oprettet i Dev Dashboard | ✅ 2026-10-13 i partnerorganisationen, custom distribution til felt-post (første forsøg lå ved en fejl i butikkens organisation, se 1.2) |
| Udviklingsbutik | ✅ `felt-post.myshopify.com` |
| `read_payment_mandate`/`write_payment_mandate` i partnerorganisationen | ✅ Først afvist med «Indeholder ugyldige omfang», siden godkendt og i appversion 3 (se 1.2) |
| Godkendelse fra Shopify | ✅ 2026-10-14 for testappen — godkendt straks i Partner Dashboard (se 1.2, punkt 6). Produktionsappen skal søge selv |
| Selling plan group + testprodukt oprettet på udviklingsbutik | ✅ 2026-10-13 på `felt-post` (se 3.1) |
| Testordre lagt igennem | ✅ 2026-10-13, ordre #1001 — med Bogus Gateway, ikke Shopify Payments (se 3.2) |
| Restbeløb trukket manuelt fra admin | ✅ 2026-10-13, ordre #1003 med Bogus Gateway (se 3.5) |
| Restbeløb trukket via API | ✅ 2026-10-14, ordre #1001 med Bogus Gateway (se 3.4) |
| De fire fejltilfælde afprøvet (afsnit 4) | ⏳ Ikke kørt endnu — kun dokumentationen er læst |
| Annullering i kundekontoen (4.3) | 🔧 Bygget, ikke afprøvet i butikken — kræver offentlig adresse |
| Dashboard: forudbestillinger og stil | 🔧 Bygget. Opret/fjern og gem stil er kørt mod felt-post via koden, ikke via admin |
| Temablok på produktsiden | 🔧 Bygget og afprøvet i Chromium på en testside, ikke i et rigtigt tema |
| Automatisk træk på forfaldsdatoen | ⏳ Ikke bygget — kræver offentlig adresse og et planlagt job |
| Besked ved forsinkelse og samtykke over 30 dage (1.7) | ⏳ Ikke bygget — kræver valg af mailudbyder |

Koden til beviset ligger klar i `scripts/bevis.ts`. Afsnit 3 og 4 udfyldes
med Shopifys rå svar, når den har kørt. Indtil da står der, hvad Shopify
*siger* vil ske — ikke hvad vi har set ske.

---

## 1. Hvad kræves der

### 1.1 Scopes

Kilde: [About custom purchase options – Access scopes](https://shopify.dev/docs/apps/build/purchase-options) (læst 2026-10-11)
og [Shopify API access scopes](https://shopify.dev/docs/api/usage/access-scopes) (læst 2026-10-11).

Shopifys liste over scopes til *deferred purchase options*:

| Scope | Shopify-godkendelse | Bruges til |
|---|---|---|
| `write_products` | nej | Produkt og selling plan group |
| `read_purchase_options` / `write_purchase_options` | nej | Selling plans |
| `read_all_orders` | **ja** | Ordrer ældre end 60 dage |
| `read_customer_payment_methods` | **ja** | Kundens gemte betalingsmidler |
| `read_payment_mandate` / `write_payment_mandate` | **ja** | Læse betalingsaftalen og trække restbeløbet |

Derudover kræver de konkrete kald i beviset (ifølge skemavalideringen):

| Scope | Godkendelse | Kald |
|---|---|---|
| `read_orders` / `write_orders` | nej | Læse ordren, `orderCancel` |
| `read_payment_terms` | nej | `paymentTerms` og forfaldsdato |
| `read_customers` | nej | Kunden på ordren |
| `read_publications` / `write_publications` | nej | Lægge testproduktet i Online Store |

`read_all_orders` er ikke med i beviset: forudbestillinger med forfald mere
end 60 dage ude i fremtiden vil kræve det. Det skal med, før appen bruges
til rigtige forudbestillinger med lang leveringstid. **GÆT**: at ordrer
ældre end 60 dage ikke kan læses uden, også når appen selv skal trække
restbeløbet på dem — dokumentationen siger kun, at `read_orders` dækker de
seneste 60 dage.

### 1.2 Skal appen godkendes?

**Ja, for en app i vores partnerorganisation.** Her afviser Shopify de to
scopes, indtil de er godkendt. Det er set i praksis (se «Set i praksis»
nedenfor). En app i butikkens egen organisation fik derimod lov at erklære
dem — hvad det betyder, er uafklaret.

Kilder (læst 2026-10-11):

- [Shopify API access scopes – Shopify approval scopes](https://shopify.dev/docs/api/usage/access-scopes):
  «You can't add one to your app configuration until Shopify approves your
  app for it. If you declare one before approval, then creating an app
  version fails with an `app_access` validation error on scopes.» For
  scopes uden egen ansøgningsvej (det gælder `*_payment_mandate`): «contact
  Shopify Support and describe your app and why it needs the scope.»
- [Model pre-order and TBYB apps – Requirements](https://shopify.dev/docs/apps/build/purchase-options/deferred/model-deferred-purchase-solutions):
  «Most subscriptions, pre-order and try before you buy apps need to request
  API access through the Partner Dashboard. We give API access to apps that
  are designed according to our principles …»
- Samme side: «Custom apps created in the Shopify admin can't use
  subscriptions, pre-order or TBYB because these apps can't use extensions
  or request access to protected scopes. If you're building a solution for a
  single store, then create your custom app in the Dev Dashboard.»

De to kilder peger på hver sin vej (Shopify Support vs. Partner Dashboard).
**GÆT**: Ansøgningen starter i Dev Dashboard/Partner Dashboard under *API
access requests*; findes der ikke et kort dér for payment mandates, skrives
der til Shopify Support.

**Set i praksis (2026-10-13):**

1. Appen blev oprettet i Dev Dashboard under organisationen Lalatoto of
   Denmark. Første gang blev det opfattet som en afvisning af de to scopes,
   og de blev taget ud. Den nøjagtige fejltekst blev ikke gemt, og det er
   uklart, hvad den egentlig handlede om.
2. Samme dag blev en ny appversion med `read_payment_mandate` og
   `write_payment_mandate` gemt og frigivet **uden fejl**. Det modsiger
   citatet ovenfor om, at versionen fejler med `app_access`.
3. Shopify Support (chat, samme dag) svarede: «I can't grant
   read_payment_mandate or write_payment_mandate from this chat. Your
   request needs Shopify review; an advisor can review the app's access
   request and guide you through the next step, but I can't promise
   approval.» Support bad om appens navn eller id og fejlteksten.

**UKENDT**: om en butik kan godkende installationen med de to scopes, og om
`orderCreateMandatePayment` faktisk virker. Det første tjek, når beviset
kører: feltet `scope` i svaret fra client credentials-tokenet viser, hvilke
scopes Shopify reelt har givet appen på butikken.

4. Appen blev oprettet forfra i **partnerorganisationen** med alle scopes fra
   1.1. Dev Dashboard afviste den med den nøjagtige fejltekst:
   «Indeholder ugyldige omfang: read_payment_mandate, write_payment_mandate».
   Det svarer til dokumentationens `app_access`-fejl. Appen er derfor oprettet
   uden de to scopes.

**Forbehold:** Appen i punkt 1 og 2 lå i organisationen for butikken
lalatoto.dk, ikke i vores partnerorganisation. Den blev slettet samme dag og
oprettes forfra under partnerorganisationen, hvor udviklingsbutikken
`felt-post.myshopify.com` også ligger. Punkt 4 viser, at Shopify **ikke**
behandler de to scopes ens i de to slags organisationer. **UKENDT**: om
appen i butikkens organisation reelt kunne have trukket penge — den blev
aldrig afprøvet.

5. **Shopify Support, rådgiveren Khalid (chat, 2026-10-14)** bekræftede, at
   appen kvalificerer sig som en app med udskudt køb, og forklarede fejlen i
   punkt 4: de to scopes er begrænsede og kan ikke tilføjes i Dev Dashboard.
   De skal søges i **Partner Dashboard** som tre separate ansøgninger, der
   behandles samlet:
   1. Læs alle ordrer (`read_all_orders`)
   2. Abonnements-API (`write_customer_payment_methods`)
   3. Betalingsaftale-API (`write_payment_mandate` — giver automatisk
      `read_payment_mandate`)

   Sagsnumrene fra de tre ansøgninger skal sendes til Support i samme chat,
   så de kan knyttes sammen. **Godkendelse gælder pr. app:** en godkendelse
   af testappen overføres ikke til produktionsappen til lalatoto.dk, som skal
   have sine egne tre ansøgninger med sit eget Client ID.

   Bemærk: Support nævner `write_customer_payment_methods`, mens listen i 1.1
   har `read_customer_payment_methods`. **UKENDT**: om begge kommer med
   abonnements-API'et.

6. **Godkendt 2026-10-14.** Siden findes ikke i menuen: et klik på appen i
   Partner Dashboard sender videre til Dev Dashboard. Den direkte adresse
   virker: `partners.shopify.com/<organisation>/apps/<app>/api_access`
   (her `…/3932028/apps/434972327937/api_access`). Alle tre kort viste
   «Du har nu adgang» med det samme, uden sagsnumre.
   Derefter skulle scopes i en ny appversion (`lalatoto-forudbestilling-3`),
   og **felt-post skulle selv godkende opdateringen** i admin under Apps.
   Først derefter viste token-svaret de nye scopes:

   ```
   write_products,write_purchase_options,write_orders,read_all_orders,read_customers,read_payment_terms,write_payment_mandate,write_publications
   ```

   `read_payment_mandate` står ikke for sig selv, fordi `write_payment_mandate`
   dækker læsning — det gemte kort kunne læses.

`shopify.app.toml` har nu samme scopes som version 3.

### 1.3 Skal butikken godkendes?

**Nej, ikke ifølge dokumentationen.** Der står intet om, at butikken skal
godkendes til forudbestilling — modsat abonnementer, hvor «merchants must
meet the qualifying criteria»
([Pre-orders and TBYB i temaer](https://shopify.dev/docs/storefronts/themes/pricing-payments/preorder-tbyb), læst 2026-10-11).
Kravene til butikken er betalingsudbyder og checkout (næste afsnit).
**GÆT**: at fraværet af et krav betyder, at der ikke er et. Det er en slutning,
ikke noget Shopify skriver.

### 1.4 Er Shopify Payments et ubetinget krav?

**Nej.** Kilde: [About pre-order and TBYB – Limitations](https://shopify.dev/docs/apps/build/purchase-options/deferred) (læst 2026-10-11):

> To use pre-order and TBYB options, merchants need to use one of the
> following payment gateways: Shopify Payments, PayPal Express, Adyen on
> Shopify, Stripe, which is only available to some merchants.

Det er altså én af fire — men andre udbydere virker ikke.

Samme side har en begrænsning, der rammer en dansk butik direkte:

> Customers can't use local payment methods for subscriptions, pre-orders and TBYB.

**GÆT**: MobilePay regnes som en lokal betalingsmetode og kan derfor ikke
bruges til forudbestilling. Det skal afprøves, for det betyder, at kunder,
der kun vil betale med MobilePay, ikke kan forudbestille.

**Afklaret (2026-10-13):** lalatoto.dk bruger kun Shopify Payments (oplyst af
Nicolaj). Det er én af de fire, så butikken opfylder kravet. Begrænsningen
om lokale betalingsmetoder gælder stadig: tilbyder Shopify Payments
MobilePay i checkout, kan kunder, der vælger MobilePay, sandsynligvis ikke
forudbestille (**GÆT**, se ovenfor).

### 1.5 Andre begrænsninger

Fra [About pre-order and TBYB – Limitations](https://shopify.dev/docs/apps/build/purchase-options/deferred) (læst 2026-10-11):

- Virker ikke i Shopify POS.
- Virker ikke på draft orders og ikke med B2B.
- Understøtter ikke «Buy X get Y»-rabatter.
- Understøtter ikke cart permalinks (links direkte til checkout med varen).
- Virker ikke på butikker, der stadig bruger `checkout.liquid`.
- Order Edits API kan kun *fjerne* en forudbestilt vare, ikke ændre den.
- **Kun én udskudt forfaldsdato pr. ordre.** Har kurven flere
  forudbestillinger med forskellige datoer, bruges den tidligste. Er én af
  dem «betal ved afsendelse», vinder den over faste datoer.
- «Betal ved afsendelse» (`ON_FULFILLMENT`) for pre-order var i `unstable`
  og planlagt til stabil i 2026-01. **UKENDT**: om det er sket — vi bruger
  fast dato (`EXACT_TIME`) i beviset.

### 1.6 Hvem gør hvad

Fra [Model pre-order and TBYB apps – Division of responsibilities](https://shopify.dev/docs/apps/build/purchase-options/deferred/model-deferred-purchase-solutions) (læst 2026-10-11):

| Shopify | Appen (os) |
|---|---|
| Opkræver første betaling (depositum) | Gemmer forretningsdata om forudbestillingen |
| Gemmer kundens betalingsmiddel | Markerer, at det er en forudbestilling |
| Håndterer lager | Giver kunden en måde at håndtere ordren på |
| | Afgør, hvornår forudbestillingen sættes i gang |
| | **Trækker restbeløbet på forfaldsdatoen** |
| | Planlægger afsendelse |

Det vigtigste: **Shopify trækker ikke restbeløbet selv**, heller ikke når
forfaldsdatoen er sat i planen. Fra
[About pre-order and TBYB](https://shopify.dev/docs/apps/build/purchase-options/deferred):
«It's your app's responsibility to schedule the charge at the right time and
automate any process around payment failures.»

### 1.7 Krav til appen, før den bruges på rigtige kunder

Fra [Model pre-order and TBYB apps – Requirements og Prohibited actions](https://shopify.dev/docs/apps/build/purchase-options/deferred/model-deferred-purchase-solutions) (læst 2026-10-11):

- Kunden skal kunne annullere sin forudbestilling inde i løsningen.
- Kunden skal have besked, når afsendelsen bliver forsinket.
- Er der ingen leveringstid angivet, skal kunden give samtykke til
  forsinkelser over 30 dage, og pengene skal kunne gives tilbage, hvis hun
  ikke gør.
- Forbudt: at gemme betalingsmidler til andet end den udskudte betaling, at
  trække mere end planen siger, og at bruge API'et til afbetaling, lay-away
  eller crowdfunding.

Overtrædelse er et brud på Shopifys API-licens. Det er ikke med i beviset,
men skal være med, før appen tages i brug.

---

## 2. Opsætning af appen

- Appen er en **custom app** oprettet med Shopify CLI under vores
  organisation i Dev Dashboard og installeret på én udviklingsbutik. Ingen
  App Store, ingen review. (`distribution: AppDistribution.SingleMerchant` i
  `app/shopify.server.ts`.)
- **Distribution (valgt 2026-10-13): Custom distribution til
  `felt-post.myshopify.com`.** Valget kan ikke ændres bagefter. En custom app
  kan kun installeres på flere butikker, når de ligger i samme
  Plus-organisation
  ([Select a distribution method](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method), læst 2026-10-13).
  Denne app er derfor en ren testapp. Drift på lalatoto.dk kræver en ny app
  med samme kode.
- Scripts og integrationstest henter token med *client credentials grant*,
  som kun virker, når app og butik ligger i samme organisation
  ([Authenticate an app for stores in your organization](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant), læst 2026-10-11).
  Token gemmes aldrig på disk.
- Scripts nægter at køre, hvis butikken ikke er en udviklingsbutik
  (`shop.plan.partnerDevelopment`). Det beskytter lalatoto.dk.
- Skabelonen er Shopifys officielle Remix-skabelon, som du bad om. Shopify
  skriver selv i skabelonen: «For new projects, use the Shopify App
  Template – React Router instead.» Remix-pakken understøtter højst API-version
  2026-04. Se README.

---

## 3. Beviset: hvad Shopify opretter

> ✅ **3.1–3.5 er kørt** (2026-10-13 og 2026-10-14) mod felt-post med
> Bogus Gateway. Shopify Payments er ikke afprøvet.

### 3.1 Planen

Kørt 2026-10-13 mod `felt-post.myshopify.com`:

```shell
SHOPIFY_STORE=felt-post.myshopify.com npm run bevis -- opret --dato 2026-11-12
```

**Butikstjekket:** `assertDevelopmentStore` svarede
«Butik: Felt-post (felt-post.myshopify.com), valuta DKK, udviklingsbutik ✔» —
altså `shop.plan.partnerDevelopment: true`.

**Scopes i token-svaret** (feltet `scope` fra client credentials grant):

```
write_products,write_purchase_options,write_orders,read_customers,read_payment_terms,write_publications
```

- Det svarer til `shopify.app.toml`. Shopify skriver kun `write_*`, når appen
  også har `read_*` — `read_products`, `read_purchase_options`, `read_orders`
  og `read_publications` står derfor ikke for sig selv. **GÆT**: at
  `write_*` dækker læsning; kaldene, der læser, virkede.
- **`read_payment_mandate` og `write_payment_mandate` er der ikke**, som
  forventet (se 1.2). Heller ikke `read_customer_payment_methods`.
- Client credentials virkede: app og butik ligger altså i samme organisation.

**Hvad Shopify oprettede:**

| Objekt | Id |
|---|---|
| `Product` | `gid://shopify/Product/11362090942806` (handle `forudbestilling-testprodukt-2026-10-13`) |
| `ProductVariant` | `gid://shopify/ProductVariant/55731226018134`, pris 499,00 DKK |
| `SellingPlanGroup` | `gid://shopify/SellingPlanGroup/78393114966` |
| `SellingPlan` | `gid://shopify/SellingPlan/691307512150` |

Planen, som Shopify gemte den (rå svar fra `sellingPlanGroupCreate`, forkortet):

```json
{
  "category": "PRE_ORDER",
  "billingPolicy": {
    "checkoutCharge": { "type": "PERCENTAGE", "value": { "percentage": 0 } },
    "remainingBalanceChargeTrigger": "EXACT_TIME",
    "remainingBalanceChargeExactTime": "2026-11-12T08:00:00Z",
    "remainingBalanceChargeTimeAfterCheckout": null
  },
  "deliveryPolicy": {
    "fulfillmentTrigger": "EXACT_TIME",
    "fulfillmentExactTime": "2026-11-12T08:00:00Z",
    "preAnchorBehavior": "ASAP"
  },
  "inventoryPolicy": { "reserve": "ON_SALE" }
}
```

`08:00:00Z` er kl. 9 dansk vintertid den 12. november — som tiltænkt.
`userErrors` var tomme i både `productSet` og `sellingPlanGroupCreate`.

**Set undervejs:**

1. **Online Store blev ikke fundet i første kørsel.** På felt-post er
   `catalog` `null` for alle tre salgskanaler (Online Store, Point of Sale,
   Shop), så opslaget på `catalog.title` ramte ingenting. Scriptet slår nu
   også op på `name`. Produktet blev derefter udgivet med
   `publishablePublish` (ingen `userErrors`), og
   `publishedOnPublication` svarer `true`. `onlineStoreUrl` er stadig `null`
   — **GÆT**: fordi butikken er beskyttet med adgangskode.
2. `deliveryPolicy.preAnchorBehavior` kom tilbage som `ASAP`, selv om vi ikke
   satte den. **UKENDT**: hvad den betyder for en fast leveringsdato.
3. `requiresSellingPlan` er `false`: produktet kan også købes til fuld pris
   uden forudbestilling. Godt nok til beviset; skal overvejes i drift.
4. Planens navn og valgmulighed siger «betal ved afsendelse» /
   «resten ved afsendelse», men planen trækker på en fast dato
   (`EXACT_TIME`). Teksten ses af kunden i checkout og bør rettes, før
   appen bruges på rigtige kunder.

### 3.2 Testordren

Ifølge [Model pre-order and TBYB apps – Lifecycle](https://shopify.dev/docs/apps/build/purchase-options/deferred/model-deferred-purchase-solutions)
opretter Shopify ved køb: ordren, **betalingsaftalen** (`PaymentTerms`) med
en **betalingsplan** (`PaymentSchedule`), en fulfillment order, og gemmer
kundens betalingsmiddel (`PaymentMandate`).

**Lagt 2026-10-13** i felt-posts checkout: ordre `#1001`,
`gid://shopify/Order/8234472341846`, bekræftelse `C0U2ZIGEJ`.

**Forbehold: betalt med Bogus Gateway** («(for testing) Bogus Gateway», kort
«1»), ikke Shopify Payments. Bogus Gateway er ikke blandt de fire udbydere,
der understøtter forudbestilling (1.4), men checkout tog imod den. Trækket
(3.4) skal afprøves på en ordre betalt med Shopify Payments i testtilstand.

**Set i checkout:**

- Kurven: 499,00 kr. + fragt 49,00 kr. = 548,00 kr.
  «Due today: 0,00 kr», «Due 12 Nov: 548,00 kr».
- **Fragten udskydes også.** Restbeløbet er 548 kr., ikke 499 kr.
- Over kortfeltet: «Your card will be charged on 12 November.»
- Under betalingsknappen står Shopifys egen samtykketekst: «One or more items
  in your cart is a deferred or recurring purchase. By continuing with your
  payment, you agree that your payment method will automatically be charged
  at the price and frequency listed on this page until it ends or you cancel.
  All cancellations are subject to the cancellation policy.»
- Planens navn «Forudbestil – betal ved afsendelse» står under varen. Det er
  forkert, for der trækkes på en fast dato (se 3.1, punkt 4).
- Bekræftelsessiden viser «Paid today 0,00 kr» og betalingsmetoden «Fixed».

**Rå svar** (`npm run bevis -- vis --ordre 8234472341846`, forkortet):

```json
{
  "name": "#1001",
  "displayFinancialStatus": "PENDING",
  "displayFulfillmentStatus": "SCHEDULED",
  "test": false,
  "totalPriceSet":       { "shopMoney": { "amount": "548.0", "currencyCode": "DKK" } },
  "totalReceivedSet":    { "shopMoney": { "amount": "0.0",   "currencyCode": "DKK" } },
  "totalOutstandingSet": { "shopMoney": { "amount": "548.0", "currencyCode": "DKK" } },
  "paymentGatewayNames": [],
  "lineItems": [{
    "quantity": 1,
    "sellingPlan": { "sellingPlanId": "gid://shopify/SellingPlan/691307512150",
                     "name": "Forudbestil – betal ved afsendelse" },
    "originalUnitPriceSet": { "shopMoney": { "amount": "499.0", "currencyCode": "DKK" } }
  }],
  "transactions": []
}
```

- **Ingen transaktioner.** Checkout har hverken autoriseret eller trukket
  noget, heller ikke 0 kr. Med Bogus Gateway opdages et ugyldigt kort altså
  først ved trækket. **UKENDT**: om Shopify Payments gør det samme (åbent
  spørgsmål 4 i afsnit 5).
- `test` er `false`, selv om ordren er betalt med en testudbyder.
  **GÆT**: fordi `test` kun sættes ud fra en transaktion, og der ingen er.
- `paymentGatewayNames` er tom af samme grund.
- `paymentCollectionDetails.additionalPaymentCollectionUrl` er udfyldt med
  et link til en betalingsside for ordren. Linket indeholder en hemmelig
  nøgle og er derfor ikke skrevet her. **UKENDT**: om linket kan sendes til
  kunden, hvis trækket fejler (4.1).

### 3.3 Betalingsaftalen og forfaldsdatoen

Forfaldsdatoen læses på ordren:

```graphql
order(id: $id) {
  paymentTerms {
    paymentSchedules(first: 5) {
      nodes { id dueAt completedAt due balanceDue { amount currencyCode } }
    }
  }
}
```

Kilde: [PaymentSchedule](https://shopify.dev/docs/api/admin-graphql/2026-04/objects/PaymentSchedule) og
[PaymentTerms](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/PaymentTerms) (læst 2026-10-11).

**Rå svar for ordre #1001:**

```json
"paymentTerms": {
  "id": "gid://shopify/PaymentTerms/86124888406",
  "paymentTermsName": "Fixed",
  "paymentTermsType": "FIXED",
  "dueInDays": null,
  "due": false,
  "overdue": false,
  "paymentSchedules": { "nodes": [{
    "id": "gid://shopify/PaymentSchedule/90087293270",
    "dueAt": "2026-11-12T08:00:00Z",
    "issuedAt": null,
    "completedAt": null,
    "due": false,
    "balanceDue":   { "amount": "548.0", "currencyCode": "DKK" },
    "totalBalance": { "amount": "548.0", "currencyCode": "DKK" }
  }]}
}
```

- `dueAt` er præcis planens `remainingBalanceChargeExactTime` (kl. 9 dansk
  tid 12. november). Forfaldsdatoen kommer altså fra planen og ikke fra
  købstidspunktet.
- `paymentTermsType` er `FIXED` — den samme type, som bruges til fakturaer
  med fast forfaldsdato.
- `balanceDue` = 548 kr. inklusive fragt (se 3.2).

**Det gemte betalingsmiddel kan ikke læses endnu.** Feltet
`order.paymentCollectionDetails.vaultedPaymentMethods` gav:

```json
{
  "message": "Access denied for vaultedPaymentMethods field. Required access: `read_payment_mandate` access scope.",
  "extensions": { "code": "ACCESS_DENIED" }
}
```

`vis` falder nu tilbage til at læse ordren uden feltet, og `decideCharge`
svarer `NO_MANDATE`: «Ordren har intet gemt betalingsmiddel, der kan trækkes
på». Det er korrekt set fra appen — den kan ikke se kortet. **UKENDT**: om
der overhovedet er gemt et `PaymentMandate`, når ordren er betalt med Bogus
Gateway.

**Sådan ser ordren ud i admin** (skærmbillede, 2026-10-13):

- Status: «Betaling afventer» og «Planlagt».
- Boksen «Planlagt»: «Næste klargøring: 12. november 2026» og en knap
  «Klargør tidligere». Planens `fulfillmentExactTime` styrer altså, hvornår
  ordren kan sendes.
- Boksen «Betaling afventer»: Total 548,00 kr., Betalt 0,00 kr.,
  «Saldo — Forfalder 12. nov. 2026 — 548,00 kr.». Den tidligere **GÆT** om
  «Betaling forfalder» holdt næsten: admin skriver «Forfalder».
- Knapperne **«Send faktura»** og **«Opkræv betaling»**. **UKENDT**: om
  «Opkræv betaling» trækker på kundens gemte kort uden appen. Gør den det,
  kan butikken trække restbeløbet manuelt, indtil appen får
  `write_payment_mandate` — og vi kan afprøve trækket nu. Afprøvet på
  ordre #1003, se 3.5. #1001 er urørt og venter på `traek`.


### 3.4 Kaldene, der trækker beløbet

`npm run bevis -- traek --ordre <id> --foer-tid`:

1. Læs ordren (`ORDER_QUERY`) og find den åbne betalingsplan og et gyldigt `PaymentMandate`.
2. `orderCreateMandatePayment(id, mandateId, paymentScheduleId, idempotencyKey, amount, autoCapture: true)`.
   Svaret er et `job` og et `paymentReferenceId`. Betalingen behandles
   **asynkront**.
3. Spørg med `orderPaymentStatus(orderId, paymentReferenceId)`, indtil
   status ikke længere er `INITIATED`, `PROCESSING` eller `PENDING`.
4. Læs ordren igen: `completedAt` på planen og `totalOutstandingSet` = 0.

Kilde: [orderCreateMandatePayment](https://shopify.dev/docs/api/admin-graphql/2026-04/payloads/OrderCreateMandatePaymentPayload)
og [About pre-order and TBYB – Charging the remaining balance](https://shopify.dev/docs/apps/build/purchase-options/deferred) (læst 2026-10-11).

**Idempotensnøglen** er `po-<ordre>-<plan>-<forsøg>` (højst 32 tegn — ellers en hash af ordre og plan). Kaldes der to
gange med samme nøgle, returnerer Shopify det første resultat i stedet for at
trække igen. Et bevidst nyt forsøg efter en afvisning får et nyt forsøgsnummer.

`autoCapture: false` autoriserer kun beløbet, så det kan trækkes senere
(`--kun-autoriser`).

**Kørt 2026-10-14** på ordre `#1001` (`gid://shopify/Order/8234472341846`)
med `npm run bevis -- traek --ordre 8234472341846 --foer-tid`.

**Skridt 1 — det gemte betalingsmiddel** (nu læsbart):

```json
"vaultedPaymentMethods": [{
  "id": "gid://shopify/PaymentMandate/3e0a1afe30cf040276afd9a516478b5f",
  "paymentInstrument": { "__typename": "VaultCreditCard", "brand": "Bogus",
    "lastDigits": "1", "expiryMonth": 9, "expiryYear": 2028, "expired": false }
}]
```

**To afvisninger undervejs, som koden nu tager højde for:**

1. **`amount` kræver Shopify Plus.** Første kald gav `ACCESS_DENIED`:
   «The API client must be installed on a Shopify Plus store to use the
   amount field.» Uden `amount` trækker Shopify hele restbeløbet på den
   betalingsplan, `paymentScheduleId` peger på. `decideCharge` sender derfor
   kun beløbet med `sendAmount` (`--med-beloeb`). Uden det nægter den at
   trække, hvis ordrens udestående er *mindre* end planens restbeløb (fx
   efter en delvis refusion), for så kan beløbet ikke begrænses
   (`AMOUNT_MISMATCH`). lalatoto.dk er på Grow, ikke Plus (afsnit 5).
2. **Idempotensnøglen må højst være 32 tegn.** «Idempotency key should be
   less than or equal to 32 characters long.» Den gamle nøgle
   `preorder-8234472341846-90087293270-1` var 36. Den nye er
   `po-<ordre>-<plan>-<forsøg>` og falder tilbage til en hash, hvis den
   bliver for lang.

**Skridt 2 — `orderCreateMandatePayment`:**

```json
{
  "job": { "id": "gid://shopify/Job/4c3351d4-71d1-4da0-be99-1a2d86935458", "done": false },
  "paymentReferenceId": "8234472341846/po-8234472341846-90087293270-1",
  "userErrors": []
}
```

**Skridt 3 — `orderPaymentStatus`:**

```json
{
  "status": "PURCHASED",
  "errorMessage": null,
  "transactions": [{ "kind": "SALE", "status": "SUCCESS",
    "amountSet": { "shopMoney": { "amount": "548.0", "currencyCode": "DKK" } } }]
}
```

**Skridt 4 — ordren bagefter:** `displayFinancialStatus: PAID`,
`totalReceivedSet` 548,00, `totalOutstandingSet` 0,00, planen har
`completedAt: 2026-10-14T18:30:39Z` og `balanceDue` 0,00. Én transaktion:
`SALE`, `SUCCESS`, `gateway: bogus`, `test: true`, 548,00 DKK.

**Samme kald igen** med samme nøgle gav `userErrors`: «payment schedule
amount must be greater than zero.» Der blev ikke trukket igen. Shopify
stopper altså et nyt træk på en betalt plan. **UKENDT**: om samme nøgle
returnerer det første resultat, mens den første betaling stadig behandles —
det er det tilfælde, nøglen er til for.

Status `PURCHASED` er ikke nævnt i dokumentationens beskrivelse af
forløbet. `traek` venter, så længe status er `INITIATED`, `PROCESSING` eller
`PENDING`, og stoppede korrekt her.

### 3.5 Manuelt træk fra admin (uden appen)

Afprøvet 2026-10-13 på ordre `#1003` (`gid://shopify/Order/8234493378902`),
lagt som #1001: forudbestilling, 0 kr. ved checkout, Bogus Gateway, kort «1».

(Ordre `#1002` blev et almindeligt køb til fuld pris: varen kom i kurven med
produktsidens knap og fik ingen selling plan. Den viser, at produktet kan
købes uden forudbestilling, fordi `requiresSellingPlan` er `false` — se 3.1.)

**I admin:** pilen ved «Opkræv betaling» viste tre valg:

- «Bogus •••• 1» — kundens gemte kort
- «Andet kreditkort»
- «Marker som betalt»

Valget «Bogus •••• 1» gav straks «Betaling modtaget». Ordren skiftede fra
«Betaling afventer» til «Betalt», og tidslinjen viser «En betaling på
548,00 kr. DKK blev behandlet …» og en mail om «Order payment receipt» til
kunden.

**Rå svar bagefter** (`npm run bevis -- vis --ordre 8234493378902`, forkortet):

```json
{
  "displayFinancialStatus": "PAID",
  "displayFulfillmentStatus": "SCHEDULED",
  "totalReceivedSet":    { "shopMoney": { "amount": "548.0", "currencyCode": "DKK" } },
  "totalOutstandingSet": { "shopMoney": { "amount": "0.0",   "currencyCode": "DKK" } },
  "paymentGatewayNames": ["bogus"],
  "paymentTerms": { "paymentSchedules": { "nodes": [{
    "id": "gid://shopify/PaymentSchedule/90087358806",
    "dueAt": "2026-11-12T08:00:00Z",
    "completedAt": "2026-10-13T18:44:37Z",
    "balanceDue": { "amount": "0.0", "currencyCode": "DKK" }
  }]}},
  "transactions": [{
    "kind": "SALE", "status": "SUCCESS", "gateway": "bogus", "test": true,
    "createdAt": "2026-10-13T18:44:37Z",
    "amountSet": { "shopMoney": { "amount": "548.0", "currencyCode": "DKK" } }
  }]
}
```

`decideCharge` svarer nu `ALREADY_PAID`: «Alle betalingsplaner på ordren er
gennemført».

**Hvad det viser:**

1. **Shopify gemmer kortet ved checkout**, også ved 0 % og med Bogus
   Gateway. Det besvarer det **UKENDT** i 3.3 for Bogus Gateway.
2. **Butikken kan trække restbeløbet manuelt fra admin uden appen.** Ét træk
   på hele saldoen, som en `SALE` (autoriseret og trukket på én gang).
   Betalingsplanen får `completedAt`, og `balanceDue` går til 0.
3. Trækket kan ske **før forfaldsdatoen**. Admin spurgte ikke.
4. Ordren forbliver «Planlagt» til 12. november — betaling og afsendelse er
   uafhængige.
5. `test` på ordren er stadig `false`, selv om transaktionen har
   `test: true`.

**Konsekvens:** Indtil Shopify godkender `write_payment_mandate`, kan
forudbestillinger håndteres manuelt: butikken klikker «Opkræv betaling» på
hver ordre på forfaldsdatoen. **GÆT**: at Shopify Payments opfører sig ens —
afprøvet kun med Bogus Gateway.

---

## 4. Fire tilfælde: hvad sker der?

> ⏳ **Ikke afprøvet.** Hvert tilfælde har: hvad dokumentationen siger, hvad
> vi ikke ved, og hvordan det afprøves på udviklingsbutikken.

Mulige statusser fra `orderPaymentStatus` ([OrderPaymentStatusResult](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/OrderPaymentStatusResult), læst 2026-10-11):
`AUTHORIZED`, `CAPTURED`, `ERROR`, `INITIATED`, `PARTIAL_SUCCESS`, `PENDING`,
`PROCESSING`, `PURCHASED`, `REDIRECT_REQUIRED`, `REFUNDED`, `RETRYABLE`,
`SUCCESS`, `UNKNOWN`, `VOIDED`. Svaret har også `errorMessage` og
`translatedErrorMessage`.

### 4.1 Betalingen fejler

- **Dokumentation:** Appen har ansvaret for at «automate any process around
  payment failures». `orderPaymentStatus` giver `ERROR` eller `RETRYABLE` og
  en fejltekst. Kunden kan få et nyt betalingsmiddel på ordren ved, at
  butikken sender en mail fra kundens side i admin («payment method
  component on the customer details page»).
- **UKENDT:** Om Shopify selv sender kunden en mail ved fejlet træk
  (**GÆT**: nej, når appen trækker). Om ordren skifter status i admin. Om
  `RETRYABLE` betyder, at samme idempotensnøgle må bruges igen.
- **Afprøves:** Læg en ordre med Shopify Payments' testkort for afvisning,
  træk med `traek --foer-tid`, og gem svaret. **GÆT**: at et
  afvisningskort, der går igennem checkout ved 0 %, først afvises ved
  trækket — det hænger på det ukendte i 3.2.

### 4.2 Kortet er udløbet

- **Dokumentation:** `PaymentMandate.paymentInstrument` har `expiryMonth`,
  `expiryYear` og `expired`. Kunden kan opdatere sit betalingsmiddel via
  mailen fra admin.
- **Vores logik:** `pickMandate` springer kort over, som Shopify markerer
  `expired`, og advarer, når kortet udløber før forfald (`cardExpiresBefore`).
  Så kan appen bede kunden opdatere kortet *før* forfald i stedet for efter.
- **UKENDT:** Om Shopify fjerner et udløbet kort fra
  `vaultedPaymentMethods` eller blot sætter `expired: true`. Om kortudstederen
  opdaterer kortet automatisk (account updater) — **GÆT**: det gør Shopify
  Payments for nogle kort, men det står ikke i de læste kilder.
- **Afprøves:** Vanskeligt at fremkalde i testtilstand. Forslag: læg en ordre
  med et testkort, der udløber i indeværende måned, og træk efter
  månedsskiftet. Alternativt kun: se, hvad `expired` siger.

### 4.3 Kunden annullerer

- **Dokumentation:** Appen **skal** give kunden en måde at annullere på
  (krav i 1.7). Shopify giver ikke selv kunden en annulleringsknap til
  forudbestillinger i de læste kilder.
- **Det betyder i praksis:** Kundens annullering ender som et
  `orderCancel`-kald fra appen (samme som 4.4, med `reason: CUSTOMER`).
- **Bygget (2026-10-14), ikke afprøvet i butikken endnu:** knappen
  «Annuller forudbestilling» i ordrens handlingsmenu i kundekontoen
  (`extensions/preorder-annuller`, valgt af Nicolaj frem for et link i
  ordrebekræftelsen). Den kalder `app/routes/api.preorder-cancel.tsx`, som
  godkender kaldet med kundekontoens session token og bruger tokenets `sub`
  som kunde-id. `app/lib/preorder/cancel.ts` tillader kun annullering, når:
  - ordren tilhører kunden, der er logget ind,
  - ordren har en betalingsaftale og en linje med en plan, Shopify svarer
    `category: PRE_ORDER` for (ikke et abonnement),
  - ordren ikke er annulleret,
  - varen ikke er sendt (`SCHEDULED`, `UNFULFILLED` eller `ON_HOLD`).

  Er der trukket penge, refunderes de til det oprindelige betalingsmiddel
  (`refundMethod.originalPaymentMethodsRefund`). Lageret lægges tilbage, og
  Shopify sender kunden en mail (`notifyCustomer: true`).
- **Forudsætninger, før knappen virker:**
  1. Appen kører på en offentlig adresse, og `APP_URL` i
     `extensions/preorder-annuller/src/api.js` peger på den.
  2. «Allow network access in checkout and account UI extensions» på
     appens API-adgangsside i Partner Dashboard (godkendes straks ifølge
     [Enable extension capabilities for customer accounts](https://shopify.dev/docs/apps/build/customer-accounts/capabilities), læst 2026-10-14).
  3. Adgang til beskyttede kundedata. Ellers har tokenet ingen `sub`, og
     appen afviser alle annulleringer (`NOT_OWNER`)
     ([Session Token API](https://shopify.dev/docs/api/customer-account-ui-extensions/2026-07/target-apis/platform-apis/session-token-api), læst 2026-10-14).
  4. Butikken bruger de nye kundekonti, ikke de klassiske.
- **Kontrolleret mod felt-post** (kun læsning): forespørgslerne svarer, og
  `decideCancel` siger ja til #1001 og #1003 (forudbestillinger) og nej til
  #1002 (almindeligt køb).
- **UKENDT:** Om `orderCancel` med refusion virker på en ordre, hvis
  restbeløb er trukket via betalingsaftalen.
- **Afprøves:** Log ind som kunden på felt-post, åbn en forudbestilling, og
  tryk «Annuller forudbestilling». Uden kundekonto:
  `npm run bevis -- annuller --ordre <id> --aarsag CUSTOMER`.

### 4.4 Vi annullerer ordren

- **Dokumentation** ([orderCancel](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/OrderCancelJobResult), læst 2026-10-11):
  Annullering kan ikke fortrydes. En autorisation, der ikke er trukket,
  frigives automatisk. Ordren kan kun annulleres, hvis den ikke har
  *ventende* autorisationer, aktive returneringer eller afsendelser, der ikke
  kan annulleres. Kunden får besked, hvis `notifyCustomer: true`.
- **Ved 0 % depositum** er der intet trukket, så der er intet at refundere.
- **Vores logik:** `decideCharge` nægter at trække fra en annulleret ordre.
- **UKENDT:** Om Shopify også selv afviser `orderCreateMandatePayment` på en
  annulleret ordre. Om betalingsaftalen og det gemte kort forbliver på
  ordren. Om «ventende autorisationer» blokerer annullering efter
  `--kun-autoriser`.
- **Afprøves:** Annullér en ordre, og prøv derefter at trække med en
  midlertidig kode, der går uden om `decideCharge` — for at se Shopifys eget
  svar.

---

## 5. Åbne spørgsmål, der skal afklares først

1. ~~Får appen `read_payment_mandate` og `write_payment_mandate`?~~ Ja, for
   testappen (1.2, punkt 6). Produktionsappen skal søge selv.
5. ~~Er lalatoto.dk på Shopify Plus?~~ Nej, planen er **Grow** (oplyst af
   Nicolaj 2026-10-14). Appen kan derfor ikke angive beløbet i
   `orderCreateMandatePayment` (3.4) og trækker altid hele planens
   restbeløb. Ordrer med delvis refusion afvises af `decideCharge`
   (`AMOUNT_MISMATCH`) og skal trækkes manuelt fra admin (3.5).
2. ~~Hvilken betalingsudbyder bruger lalatoto.dk?~~ Afklaret: kun Shopify
   Payments, som understøtter forudbestilling (afsnit 1.4).
3. **Kan MobilePay bruges?** Ifølge dokumentationen sandsynligvis ikke.
4. **Godkender checkout kortet ved 0 % betaling?** Afgør, hvornår et dårligt
   kort opdages. Med Bogus Gateway: nej, ingen transaktioner (3.2). Shopify
   Payments er ikke afprøvet.
