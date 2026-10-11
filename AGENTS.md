# Shopify app development

This app is scaffolded from a Shopify app template. See the README for framework-specific details.

Use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) for all Shopify API and platform work. If missing, install it in the agent host per that page (or `npx skills add Shopify/shopify-ai-toolkit --list` for skill-compatible hosts) — do not add tooling to this repo.

## Lalatoto

- Skriv på dansk — svar, commit-beskeder og kodekommentarer.
- Læs `docs/forudsaetninger.md` før du rører betalingslogikken.
- Beløb regnes i øre (heltal), datoer i dansk tid og sendes til Shopify i UTC.
- Scripts og integrationstest må kun køre mod udviklingsbutikker. Fjern ikke
  `assertDevelopmentStore`.
- Ingen nøgler eller tokens i repoet.
