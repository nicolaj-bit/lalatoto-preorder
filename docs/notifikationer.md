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

**Hurtigst:** hele skabelonen ligger færdig og på dansk i
[`skabeloner/ordrebekraeftelse.liquid`](skabeloner/ordrebekraeftelse.liquid).
Erstat alt i «Rediger kode» med den, og gem.

**Eller selv:** sæt blokken ind lige over oversigten over varerne. Den vises kun, når en
linje er købt med en forudbestillingsplan (`selling_plan_allocation`).
Datoen kommer fra ordrens egen betalingsaftale
(`payment_terms.next_payment.due_at`), så den passer, også når datoen flyttes.
Produktets metafelt kan notifikationerne ikke læse (afprøvet 2026-10-18).

```liquid
{% assign forudbestillinger = '' %}
{% for line in line_items %}
  {% if line.selling_plan_allocation %}
    {% assign forudbestillinger = forudbestillinger | append: line.title | append: '|' %}
  {% endif %}
{% endfor %}
{%- comment -%}
  Datoen tages fra ordrens betalingsaftale, så den passer, også når datoen
  flyttes. Liquids date-filter kender ikke danske månedsnavne.
{%- endcomment -%}
{% assign forudbestilling_dato = '' %}
{% assign forfald = payment_terms.next_payment.due_at %}
{% if forfald %}
  {% assign maaneder = 'januar,februar,marts,april,maj,juni,juli,august,september,oktober,november,december' | split: ',' %}
  {% assign maaned_nr = forfald | date: '%-m' | minus: 1 %}
  {% capture forudbestilling_dato %}{{ forfald | date: '%-d' }}. {{ maaneder[maaned_nr] }} {{ forfald | date: '%Y' }}{% endcapture %}
{% endif %}
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
den nye dato i beskeden (`custom_message`). Uden ændringer viser Shopify en
almindelig faktura med «Betal nu» på butikkens sprog (engelsk på felt-post,
se billedet 2026-10-17).

Skabelonen deles derfor i to:

- **Forudbestilling:** en dansk mail om den nye dato, med varerne, uden
  betalingsknap.
- **Alt andet** (ordrekladder, fakturaer): Shopifys egen faktura, uændret.

**Hurtigst:** hele skabelonen ligger færdig i
[`skabeloner/ordrefaktura.liquid`](skabeloner/ordrefaktura.liquid): blok A,
Shopifys egen faktura oversat til dansk og blok B. Erstat alt i «Rediger
kode» med den, og gem.

**Eller selv:** *Indstillinger → Notifikationer → Kundenotifikationer →
Ordrefaktura → Rediger kode*. Indsæt blok A **helt øverst** (før alt andet)
og blok B **helt nederst** (efter alt andet). Gem, og tryk «Forhåndsvis».

**Blok A — helt øverst:**

```liquid
{%- assign er_forudbestilling = false -%}
{%- for line in line_items -%}
  {%- if line.selling_plan_allocation -%}
    {%- assign er_forudbestilling = true -%}
  {%- endif -%}
{%- endfor -%}
{%- assign forudbestilling_dato = '' -%}
{%- assign forfald = payment_terms.next_payment.due_at -%}
{%- if forfald -%}
  {%- assign maaneder = 'januar,februar,marts,april,maj,juni,juli,august,september,oktober,november,december' | split: ',' -%}
  {%- assign maaned_nr = forfald | date: '%-m' | minus: 1 -%}
  {%- capture forudbestilling_dato -%}{{ forfald | date: '%-d' }}. {{ maaneder[maaned_nr] }} {{ forfald | date: '%Y' }}{%- endcapture -%}
{%- endif -%}
{%- if er_forudbestilling -%}
<!DOCTYPE html>
<html lang="da">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#333333;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td style="padding-bottom:24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            {%- if shop.email_logo_url -%}
              <img src="{{ shop.email_logo_url }}" alt="{{ shop.name }}" style="max-width:180px;">
            {%- else -%}
              <span style="font-size:22px;">{{ shop.name }}</span>
            {%- endif -%}
          </td>
          <td align="right" style="color:#999999;font-size:14px;">Ordre {{ name }}</td>
        </tr></table>
      </td></tr>
      <tr><td>
        <h1 style="font-size:22px;font-weight:normal;margin:0 0 16px;">Ny dato for din forudbestilling</h1>
        {%- if custom_message != blank -%}
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">{{ custom_message }}</p>
        {%- elsif forudbestilling_dato != blank -%}
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Restbeløbet trækkes {{ forudbestilling_dato }} kl. 9, og varen sendes tidligst samme dag.</p>
        {%- endif -%}
        <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">Beløbet trækkes automatisk på det kort, du betalte med. Du skal ikke betale noget nu.</p>
      </td></tr>
      <tr><td style="border-top:1px solid #e5e5e5;padding-top:16px;">
        <h2 style="font-size:18px;font-weight:normal;margin:0 0 12px;">Din ordre</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">
          {%- for line in line_items -%}
          <tr>
            <td style="padding:6px 0;">{{ line.title }} × {{ line.quantity }}</td>
            <td align="right" style="padding:6px 0;">{{ line.final_line_price | money }}</td>
          </tr>
          {%- endfor -%}
          <tr><td style="padding:6px 0;color:#777777;">Fragt</td><td align="right" style="padding:6px 0;color:#777777;">{{ shipping_price | money }}</td></tr>
          <tr><td style="padding:12px 0;border-top:1px solid #e5e5e5;font-weight:bold;">I alt</td><td align="right" style="padding:12px 0;border-top:1px solid #e5e5e5;font-weight:bold;">{{ total_price | money_with_currency }}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding-top:24px;font-size:14px;line-height:1.6;color:#777777;">
        {%- unless custom_message contains 'annullere' -%}
          Du kan annullere forudbestillingen i din kundekonto, indtil varen er sendt.
        {%- endunless %}
        Har du spørgsmål, så svar på denne mail eller skriv til {{ shop.email }}.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
{%- else -%}
```

**Blok B — helt nederst:**

```liquid
{%- endif -%}
```

Alt, hvad Shopify havde i skabelonen, ligger nu mellem blok A og blok B og
bruges kun, når ordren ikke er en forudbestilling.

## Afprøvet

- 2026-10-17, felt-post: `orderInvoiceSend` med eget emne og besked på
  ordre #1005 kom frem. Uden ændret skabelon viste den Shopifys engelske
  faktura med beskeden og en «Pay now»-knap — derfor afsnit 2.

- 2026-10-17, felt-post: Med skabelonen i `skabeloner/ordrefaktura.liquid`
  kom mailen om ny dato på dansk, med datoen og uden «Betal nu».

- 2026-10-18, felt-post, #1006: Blokken «Din forudbestilling» vises kun ved
  forudbestilling. Metafeltet var tomt i mailen; «Skal betales 24/10/2026»
  fra betalingsaftalen virkede.

## Ikke afprøvet endnu

- Ordrebekræftelsen med datoen fra betalingsaftalen. 2026-10-18 viste #1006
  blokken korrekt, men uden dato, fordi den dengang læste metafeltet.
