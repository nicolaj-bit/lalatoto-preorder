import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from '../generated/api';

/**
 * Tilbud i procent.
 *
 * Hver vare i kurven, hvis produkt har «Tilbud i procent» (metafeltet
 * lalatoto.tilbud) sat til et helt tal fra 1 til 90, får den procent i rabat.
 * Procenten regnes af prisen i kundens marked, så tilbuddet virker i alle
 * markeder uden at rette i katalogerne.
 *
 * Rabatkoderne er også varerabatter. Shopify giver højst én varerabat pr.
 * vare, så en vare på tilbud får ikke koden oveni; koden gælder kun de andre
 * varer i kurven.
 *
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

const MINDST = 1;
const HOEJST = 90;

/** Procenten fra metafeltet, eller null hvis den mangler eller er ugyldig. */
export function tilbudsprocent(value) {
  if (value == null) return null;
  const procent = Number(String(value).trim());
  if (!Number.isInteger(procent) || procent < MINDST || procent > HOEJST) return null;
  return procent;
}

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  if (!input.discount.discountClasses.includes(DiscountClass.Product)) {
    return { operations: [] };
  }

  const candidates = [];
  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;
    if (merchandise.__typename !== 'ProductVariant') continue;
    const procent = tilbudsprocent(merchandise.product.tilbud?.value);
    if (procent === null) continue;

    candidates.push({
      message: `Tilbud −${procent} %`,
      targets: [{ cartLine: { id: line.id } }],
      value: { percentage: { value: procent } },
    });
  }

  if (!candidates.length) return { operations: [] };

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}
