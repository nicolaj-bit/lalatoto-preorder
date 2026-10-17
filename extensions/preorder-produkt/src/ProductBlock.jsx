import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {changePreorderDate, createPreorder, productPreorder, removePreorder} from '../../../app/lib/preorder/catalog';
import {formatDanishDate} from '../../../app/lib/preorder/dates';

// Blokken «Forudbestilling» på produktsiden i admin. Bruger samme logik som
// resten af appen (app/lib/preorder/catalog.ts), men kalder Admin API'et
// direkte fra admin med shopify.query.

export default async () => {
  render(<ProductBlock />, document.body);
};

/** shopify.query som den Graphql-funktion, catalog.ts forventer. */
async function graphql(query, variables) {
  const result = await shopify.query(query, {variables});
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join('; '));
  }
  return result.data;
}

function ProductBlock() {
  const productId = shopify.data.selected?.[0]?.id;
  // 'loading' | 'off' | 'on' | 'error'
  const [state, setState] = useState('loading');
  const [preorder, setPreorder] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [chargeDate, setChargeDate] = useState('');
  const [deposit, setDeposit] = useState('0');
  const [newDate, setNewDate] = useState('');
  const [notice, setNotice] = useState('');
  const [notifyCustomers, setNotifyCustomers] = useState(true);

  async function load() {
    try {
      const found = await productPreorder(graphql, productId);
      setPreorder(found);
      setState(found ? 'on' : 'off');
    } catch (error) {
      setMessage(error.message);
      setState('error');
    }
  }

  useEffect(() => {
    load();
  }, [productId]);

  async function turnOn() {
    const depositPercent = Number(deposit);
    if (!Number.isInteger(depositPercent) || depositPercent < 0 || depositPercent > 99) {
      setMessage('Depositum skal være et helt tal fra 0 til 99 %.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await createPreorder(graphql, {productId, chargeDate, depositPercent});
      if (!result.ok) setMessage(result.message);
      else await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeDate() {
    setBusy(true);
    setMessage('');
    setNotice('');
    try {
      const result = await changePreorderDate(graphql, {
        groupId: preorder.groupId,
        sellingPlanId: preorder.sellingPlanId,
        productIds: preorder.products.map((p) => p.id),
        chargeDate: newDate,
        depositPercent: preorder.depositPercent ?? 0,
        notifyCustomers,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      const moved = result.ordersMoved.length;
      const mailed = result.customersNotified.length;
      setNotice(
        moved === 0
          ? 'Datoen er ændret. Der er ingen lagte ordrer at flytte.'
          : `Datoen er ændret, også på ${moved === 1 ? 'ordre' : `${moved} ordrer`} ${result.ordersMoved.join(', ')}.` +
              (mailed > 0 ? ` ${mailed === 1 ? 'Kunden har' : `${mailed} kunder har`} fået en mail om den nye dato.` : ''),
      );
      if (result.orderErrors.length > 0) {
        setMessage(`Disse ordrer har stadig den gamle dato: ${result.orderErrors.join(' · ')}`);
      }
      setNewDate('');
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage('');
    try {
      const result = await removePreorder(graphql, {
        groupId: preorder.groupId,
        productIds: preorder.products.map((p) => p.id),
      });
      if (!result.ok) setMessage(result.message);
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <s-admin-block heading="Forudbestilling" collapsedSummary="Henter …">
        <s-spinner accessibilityLabel="Henter forudbestilling" />
      </s-admin-block>
    );
  }

  if (state === 'error') {
    return (
      <s-admin-block heading="Forudbestilling" collapsedSummary="Fejl">
        <s-banner tone="critical">Forudbestillingen kunne ikke hentes: {message}</s-banner>
      </s-admin-block>
    );
  }

  if (state === 'on') {
    const dateText = preorder.chargeAt ? formatDanishDate(new Date(preorder.chargeAt)) : 'ukendt dato';
    const unlocked = preorder.products.some((p) => !p.requiresSellingPlan);
    return (
      <s-admin-block heading="Forudbestilling" collapsedSummary={`Til · resten ${dateText}`}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Kunden betaler {preorder.depositPercent ?? '?'} % ved køb. Resten trækkes {dateText} kl. 9, og varen
            sendes tidligst samme dag.
          </s-paragraph>
          {unlocked && (
            <s-banner tone="warning">
              Produktet kan stadig købes uden forudbestilling. Slå forudbestilling fra og til igen for at låse det.
            </s-banner>
          )}
          <s-date-field
            label="Ny dato for restbeløb og afsendelse"
            details="Flytter også datoen på ordrer, der allerede er lagt."
            value={newDate}
            onChange={(event) => setNewDate(event.currentTarget.value)}
          />
          <s-checkbox
            label="Send kunderne en mail om den nye dato"
            checked={notifyCustomers}
            onChange={(event) => setNotifyCustomers(event.currentTarget.checked)}
          />
          <s-button loading={busy} disabled={!newDate} onClick={changeDate}>
            Gem ny dato
          </s-button>
          {notice && <s-banner tone="success">{notice}</s-banner>}
          {message && <s-banner tone="critical">{message}</s-banner>}
          <s-paragraph>
            Fjernes forudbestillingen, beholder allerede lagte ordrer deres betalingsaftale.
          </s-paragraph>
          <s-button tone="critical" loading={busy} onClick={turnOff}>
            Slå forudbestilling fra
          </s-button>
        </s-stack>
      </s-admin-block>
    );
  }

  return (
    <s-admin-block heading="Forudbestilling" collapsedSummary="Fra">
      <s-stack direction="block" gap="base">
        <s-paragraph>
          Sælg produktet som forudbestilling. Kunden betaler depositummet ved køb, og resten trækkes automatisk på
          datoen. Produktet kan derefter kun købes som forudbestilling.
        </s-paragraph>
        <s-date-field
          label="Dato for restbeløb og afsendelse"
          value={chargeDate}
          onChange={(event) => setChargeDate(event.currentTarget.value)}
        />
        <s-number-field
          label="Depositum ved køb (%)"
          value={deposit}
          min={0}
          max={99}
          step={1}
          onChange={(event) => setDeposit(event.currentTarget.value)}
        />
        {message && <s-banner tone="critical">{message}</s-banner>}
        <s-button variant="primary" loading={busy} disabled={!chargeDate} onClick={turnOn}>
          Slå forudbestilling til
        </s-button>
      </s-stack>
    </s-admin-block>
  );
}
