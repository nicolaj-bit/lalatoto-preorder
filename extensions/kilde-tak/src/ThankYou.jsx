import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

// «Hvor hørte du om os første gang?» på takkesiden. Ét klik vælger svaret,
// og «Send svar» gemmer det på ordren gennem Base44-funktionen orderSource.
// Er der svaret før (fx ved genindlæsning), vises spørgsmålet ikke igen.
//
// Kassens udvidelser kører i en sandkasse og kender ikke adressen, så den
// står her. Base44-appen er lalatoto-dashboard (lala-order-flow).
const BASE44_ORIGIN = 'https://lala-order-flow.base44.app';
const BASE44_APP_ID = '6ad0540094b2b23633a4f532';
const ENDPOINT = `${BASE44_ORIGIN}/api/apps/${BASE44_APP_ID}/functions/orderSource`;

/** Samme rækkefølge som SOURCES i orderSourceHandler.ts. */
const SOURCES = ['instagram', 'facebook', 'tiktok', 'google', 'venner', 'influencer', 'club-no-sleep', 'andet'];
const STORAGE_KEY = 'kilde-svaret';

export default async () => {
  render(<Survey />, document.body);
};

function Survey() {
  const t = shopify.i18n.translate;
  // 'loading' → 'ask' → 'sending' → 'done' | 'error' (kan prøve igen)
  const [state, setState] = useState('loading');
  const [source, setSource] = useState('');
  const [other, setOther] = useState('');

  useEffect(() => {
    shopify.storage
      .read(STORAGE_KEY)
      .then((answered) => setState(answered ? 'hidden' : 'ask'))
      .catch(() => setState('ask'));
  }, []);

  async function onSubmit() {
    const orderId = shopify.orderConfirmation.value?.order?.id;
    if (!source || !orderId) return;
    setState('sending');
    try {
      const token = await shopify.sessionToken.get();
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-App-Id': BASE44_APP_ID,
        },
        body: JSON.stringify({orderId, source, other: source === 'andet' ? other : ''}),
      });
      const body = await res.json().catch(() => null);
      if (!body?.ok) throw new Error(body?.reason ?? `HTTP ${res.status}`);
      await shopify.storage.write(STORAGE_KEY, true).catch(() => {});
      setState('done');
    } catch (error) {
      console.warn('Lalatoto: kunne ikke gemme kilden', error);
      setState('error');
    }
  }

  if (state === 'loading' || state === 'hidden') return null;

  if (state === 'done') {
    return (
      <s-section>
        <s-text>{t('thanks')}</s-text>
      </s-section>
    );
  }

  return (
    <s-section heading={t('heading')}>
      <s-stack direction="block" gap="base">
        <s-text color="subdued">{t('lead')}</s-text>
        {state === 'error' && <s-banner tone="critical">{t('error')}</s-banner>}
        <s-choice-list
          name="kilde"
          label={t('heading')}
          labelAccessibilityVisibility="exclusive"
          variant="grid"
          values={source ? [source] : []}
          onChange={(event) => setSource(event.currentTarget.values[0] ?? '')}
        >
          {SOURCES.map((key) => (
            <s-choice key={key} value={key}>
              {t(`sources.${key}`)}
            </s-choice>
          ))}
        </s-choice-list>
        {source === 'andet' && (
          <s-text-field
            label={t('otherLabel')}
            value={other}
            maxLength={200}
            onInput={(event) => setOther(event.currentTarget.value)}
          />
        )}
        <s-button
          variant="primary"
          disabled={!source}
          loading={state === 'sending'}
          onClick={onSubmit}
        >
          {t('submit')}
        </s-button>
      </s-stack>
    </s-section>
  );
}
