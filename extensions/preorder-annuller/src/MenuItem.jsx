import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {fetchEligibility} from './api';

// Knappen vises kun på forudbestillinger, kunden selv må annullere. Spørger
// appen først; går det galt, vises knappen ikke, i stedet for at love noget,
// appen ikke kan holde.
export default async () => {
  let show = false;
  try {
    const result = await fetchEligibility(shopify.orderId);
    show = result.cancellable === true;
  } catch (error) {
    console.warn('Lalatoto Forudbestilling: kunne ikke tjekke ordren', error);
  }
  render(<MenuItem show={show} />, document.body);
};

function MenuItem({show}) {
  if (!show) return null;
  return <s-button>{shopify.i18n.translate('menu.cancel')}</s-button>;
}
