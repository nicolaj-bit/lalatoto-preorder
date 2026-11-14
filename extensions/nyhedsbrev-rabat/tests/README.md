# Testkurve

Hver fil er én kurv med det forventede svar. Kør dem med:

```shell
npx shopify app function run --path extensions/nyhedsbrev-rabat \
  --config shopify.app.live.toml --export cart-lines-discounts-generate-run \
  --input <(node -e "console.log(JSON.stringify(require('./extensions/nyhedsbrev-rabat/tests/fixtures/blandet-kurv.json').payload.input))")
```

- `blandet-kurv`: fuld pris, tilbud 50 %, tilbud «0» og et gavekort → kun linje 1 og 3 får 15 %
- `kun-tilbud`: alt er på tilbud → ingen rabat
- `ingen-produktklasse`: rabatten er ikke sat op som produktrabat → ingen rabat
