import '@shopify/ui-extensions/preact';
import {render} from 'preact';

// Rabatten «Tilbud i procent» har ingen indstillinger af sin egen: procenten
// står på hvert produkt i feltet «Tilbud i procent» (lalatoto.tilbud), og
// rabatfunktionen i extensions/tilbud læser den derfra. Siden findes, fordi
// Shopify kun viser en apps rabattype under «Opret rabat», når der er en
// indstillingsside til den. Den forklarer bare, hvordan rabatten virker.
export default async () => {
  render(<Indstillinger />, document.body);
};

function Indstillinger() {
  return (
    <s-function-settings onSubmit={(event) => event.waitUntil?.(Promise.resolve())}>
      <s-section heading="Tilbud i procent">
        <s-stack gap="base">
          <s-paragraph>
            Rabatten giver hver vare den procent, der står i feltet «Tilbud i
            procent» under produktet. Står feltet tomt, er varen ikke på tilbud.
          </s-paragraph>
          <s-paragraph>
            Der er intet at indstille her. Opret rabatten én gang som en
            automatisk rabat, og sæt den til at kunne kombineres med
            varerabatter.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-function-settings>
  );
}
