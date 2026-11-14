// Lalatoto: nyhedsbrevets rabatkode (VELKOMMEN15).
//
// Giver 15 % på hver vare i kurven, der IKKE er på tilbud. En vare er på
// tilbud, når produktets metafelt lalatoto.tilbud har en procent større end 0
// — det samme felt, som temaet viser tilbudsprisen ud fra. Så følger koden
// automatisk med, når en vare kommer på eller af udsalg.
//
// Gavekort får aldrig rabat.

import {DiscountClass, ProductDiscountSelectionStrategy} from '../generated/api';

export const PERCENT = 15;

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

/** Er varen på tilbud? Tomt felt, 0 eller noget ugyldigt tæller som fuld pris. */
export function onSale(product) {
  const value = Number(product?.tilbud?.value ?? 0);
  return Number.isFinite(value) && value > 0;
}

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  if (!input.discount.discountClasses.includes(DiscountClass.Product)) {
    return {operations: []};
  }

  const targets = input.cart.lines
    .filter((line) => {
      if (line.merchandise.__typename !== 'ProductVariant') return false;
      const product = line.merchandise.product;
      return !product.isGiftCard && !onSale(product);
    })
    .map((line) => ({cartLine: {id: line.id}}));

  if (!targets.length) return {operations: []};

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: `${PERCENT} % nyhedsbrevsrabat`,
              targets,
              value: {percentage: {value: PERCENT}},
            },
          ],
          selectionStrategy: ProductDiscountSelectionStrategy.First,
        },
      },
    ],
  };
}
