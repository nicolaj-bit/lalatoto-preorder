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
| App oprettet i Dev Dashboard | ✅ 2026-10-13 |
| Appversion med `read_payment_mandate`/`write_payment_mandate` frigivet | ✅ 2026-10-13 — ingen fejl (se 1.2) |
| Virker kaldene med de to scopes i praksis? | ⏳ Ukendt, indtil beviset kører |
| Selling plan group + testprodukt oprettet på udviklingsbutik | ⏳ Ikke kørt endnu |
| Testordre lagt igennem | ⏳ Ikke kørt endnu |
| Restbeløb trukket via API | ⏳ Ikke kørt endnu |
| De fire fejltilfælde afprøvet (afsnit 4) | ⏳ Ikke kørt endnu — kun dokumentationen er læst |

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

**Uafklaret.** Dokumentationen siger ja, men en appversion med de to scopes
blev frigivet uden fejl på en app, der kun skal bruges på vores
udviklingsbutik. Det kan betyde, at kravet ikke håndhæves for
udviklingsbutikker, eller at det først slår igennem, når API'et kaldes. Det
afgøres, når beviset kører (se «Set i praksis» nedenfor).

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

De to scopes står igen i `shopify.app.toml`, så den matcher den frigivne
version.

**Konsekvens:** Indtil beviset har kørt, regner vi stadig med, at trækket
kan blive blokeret. Sagen hos Shopify Support holdes åben, til vi ved det.

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

**UKENDT**: hvilken betalingsudbyder lalatoto.dk bruger i dag. Det skal
tjekkes under *Indstillinger → Betalinger*, før vi bygger videre.

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

> ⏳ **Ikke kørt endnu.** Nedenfor står, hvad kaldene er, og hvad
> dokumentationen siger, vi vil se. Når `scripts/bevis.ts` har kørt, erstattes
> hvert «Forventet» med Shopifys rå svar.

### 3.1 Planen

`npm run bevis -- opret --dato 2026-12-01` laver:

1. Et testprodukt (`productSet`) til 499 kr., der kan sælges uden lager.
2. En selling plan group (`sellingPlanGroupCreate`) med én plan:
   - `category: PRE_ORDER`
   - `billingPolicy.fixed.checkoutCharge: { type: PERCENTAGE, value: { percentage: 0 } }` — 0 % ved checkout
   - `remainingBalanceChargeTrigger: EXACT_TIME` og `remainingBalanceChargeExactTime` — restbeløbet forfalder 1. december kl. 9 dansk tid
   - `deliveryPolicy.fixed.fulfillmentTrigger: EXACT_TIME` — sendes tidligst samme tidspunkt
   - `inventoryPolicy.reserve: ON_SALE` — lageret reserveres ved køb
3. Produktet knyttes til gruppen og lægges i Online Store.

Objekter, Shopify opretter: `Product`, `ProductVariant`, `SellingPlanGroup`,
`SellingPlan`. **Udfyldes med id'er fra kørslen.**

### 3.2 Testordren

Ordren lægges i butikkens checkout med Shopify Payments i testtilstand.
Ifølge [Model pre-order and TBYB apps – Lifecycle](https://shopify.dev/docs/apps/build/purchase-options/deferred/model-deferred-purchase-solutions)
opretter Shopify derefter: ordren, **betalingsaftalen** (`PaymentTerms`) med
en **betalingsplan** (`PaymentSchedule`), en fulfillment order, og gemmer
kundens betalingsmiddel (`PaymentMandate`).

**Forventet** (ikke set endnu): `totalReceivedSet` = 0,00, `totalOutstandingSet`
= 499,00, `displayFinancialStatus` = `PENDING` eller lignende. **UKENDT**: om
checkout autoriserer et beløb på kortet ved 0 % — fx en kontrol på 0 kr. Det
afgør, om et ugyldigt kort opdages ved køb eller først ved forfald.

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

- `dueAt` — hvornår restbeløbet forfalder
- `balanceDue` — hvad der mangler at blive trukket
- `completedAt` — sat, når planen er betalt
- `due` / `overdue` på `paymentTerms` — om noget er forfaldent

Kilde: [PaymentSchedule](https://shopify.dev/docs/api/admin-graphql/2026-04/objects/PaymentSchedule) og
[PaymentTerms](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/PaymentTerms) (læst 2026-10-11).

Det gemte betalingsmiddel ligger på
`order.paymentCollectionDetails.vaultedPaymentMethods` som en liste af
`PaymentMandate` med kortets mærke, sidste fire cifre, udløb og `expired`
([PaymentMandate](https://shopify.dev/docs/api/admin-graphql/2026-01/objects/PaymentMandate), læst 2026-10-11).

**Udfyldes**: det rå svar fra `npm run bevis -- vis --ordre <id>`, og hvordan
forfaldsdatoen ser ud i admin på ordren. **GÆT**: at admin viser «Betaling
forfalder» med datoen.

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

**Idempotensnøglen** er `preorder-<ordre>-<plan>-<forsøg>`. Kaldes der to
gange med samme nøgle, returnerer Shopify det første resultat i stedet for at
trække igen. Et bevidst nyt forsøg efter en afvisning får et nyt forsøgsnummer.

`autoCapture: false` autoriserer kun beløbet, så det kan trækkes senere
(`--kun-autoriser`).

**Udfyldes**: rå svar fra alle fire skridt.

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
- **UKENDT:** Om kunden selv kan annullere fra sin kundekonto i Shopify.
- **Afprøves:** `npm run bevis -- annuller --ordre <id> --aarsag CUSTOMER`.

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

1. **Får appen `read_payment_mandate` og `write_payment_mandate`?** Uden dem
   intet træk. Ansøg nu.
2. **Hvilken betalingsudbyder bruger lalatoto.dk?** Er det ikke én af de
   fire, virker forudbestilling slet ikke.
3. **Kan MobilePay bruges?** Ifølge dokumentationen sandsynligvis ikke.
4. **Godkender checkout kortet ved 0 % betaling?** Afgør, hvornår et dårligt
   kort opdages.
