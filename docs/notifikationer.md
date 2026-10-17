# Shopifys mails til kunden ved forudbestilling

Kunden får to mails fra Shopify om sin forudbestilling. Begge sendes fra
butikkens egen adresse og med butikkens design. Skabelonerne kan ikke ændres
gennem API'et, så de rettes i admin under
*Indstillinger → Notifikationer → Kundenotifikationer*.

| Mail | Hvornår | Hvad der skal rettes |
|---|---|---|
| **Ordrebekræftelse** | Når ordren lægges | En blok, der kun vises, når en linje er en forudbestilling |
| **Ordrefaktura** | Når datoen flyttes med «Gem ny dato» | «Betal nu» skjules på forudbestillinger |

## 1. Ordrebekræftelse

Sæt blokken ind lige over oversigten over varerne. Den vises kun, når en
linje er købt med en forudbestillingsplan (`selling_plan_allocation`).
Datoen kommer fra produktets metafelt `lalatoto_preorder.info`, som blokken
«Forudbestilling» på produktet skriver og opdaterer, når datoen flyttes.

```liquid
{% assign forudbestillinger = '' %}
{% for line in line_items %}
  {% if line.selling_plan_allocation %}
    {% assign forudbestillinger = forudbestillinger | append: line.title | append: '|' %}
    {% assign forudbestilling_dato = line.product.metafields.lalatoto_preorder.info.value.chargeDateText %}
  {% endif %}
{% endfor %}
{% if forudbestillinger != '' %}
  <table class="row"><tr><td>
    <h3>Din forudbestilling</h3>
    <p>
      {{ forudbestillinger | split: '|' | join: ', ' }} er forudbestilt.
      {% if forudbestilling_dato != blank %}
        Restbeløbet trækkes {{ forudbestilling_dato }} kl. 9 på det kort, du har betalt med,
        og varen sendes tidligst samme dag.
      {% else %}
        Restbeløbet trækkes, når varen sendes.
      {% endif %}
      Du kan annullere forudbestillingen i din kundekonto, indtil varen er sendt.
    </p>
  </td></tr></table>
{% endif %}
```

## 2. Ordrefaktura

Appen sender denne mail (`orderInvoiceSend`) til hver kunde, hvis ordre
flyttes til en ny dato, med emnet «Ny dato for din forudbestilling #1005» og
den nye dato i beskeden. Skabelonen viser beskeden selv
(`{% if custom_message %}`), men den har også en knap til at betale. Den skal
skjules, så kunden ikke betaler restbeløbet før tid.

Øverst i skabelonen:

```liquid
{% assign er_forudbestilling = false %}
{% for line in line_items %}
  {% if line.selling_plan_allocation %}{% assign er_forudbestilling = true %}{% endif %}
{% endfor %}
```

Find derefter blokken med betalingsknappen (den med «Betal nu» /
«Complete your purchase» og linket til betalingen), og sæt den ind i:

```liquid
{% unless er_forudbestilling %}
  … betalingsknappen, uændret …
{% endunless %}
```

Fakturaer på almindelige ordrer og kladdeordrer er uændrede.

## Afprøvet

- 2026-10-17, felt-post: `orderInvoiceSend` med eget emne og besked på
  ordre #1005 blev taget imod uden fejl. Indholdet af mailen er ikke set
  endnu.

## Ikke afprøvet endnu

- At `line.selling_plan_allocation` og metafeltets `.value.chargeDateText`
  virker i notifikationernes Liquid. Afprøves med en ny testordre og
  «Forhåndsvis» i skabelonen.
