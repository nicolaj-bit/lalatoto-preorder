import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {cancelPreorder, fetchEligibility} from './api';

export default async () => {
  render(<CancelModal />, document.body);
};

function CancelModal() {
  const t = shopify.i18n.translate;
  // 'loading' → 'confirm' → 'sending' → 'done' | 'error'
  const [state, setState] = useState('loading');
  const [refunds, setRefunds] = useState(false);

  useEffect(() => {
    fetchEligibility(shopify.orderId)
      .then((result) => {
        setRefunds(result.refunds === true);
        setState(result.cancellable ? 'confirm' : 'error');
      })
      .catch(() => setState('error'));
  }, []);

  async function onCancel() {
    setState('sending');
    try {
      const result = await cancelPreorder(shopify.orderId);
      setState(result.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <s-customer-account-action heading={t('modal.doneHeading')}>
        <s-text>{t(refunds ? 'modal.doneRefund' : 'modal.done')}</s-text>
        <s-button slot="primary-action" onClick={() => shopify.close()}>
          {t('modal.close')}
        </s-button>
      </s-customer-account-action>
    );
  }

  if (state === 'error') {
    return (
      <s-customer-account-action heading={t('modal.heading')}>
        <s-banner tone="critical">{t('modal.error')}</s-banner>
        <s-button slot="primary-action" onClick={() => shopify.close()}>
          {t('modal.close')}
        </s-button>
      </s-customer-account-action>
    );
  }

  return (
    <s-customer-account-action heading={t('modal.heading')}>
      <s-stack direction="block" gap="base">
        <s-text>{t('modal.body')}</s-text>
        {state !== 'loading' && <s-text>{t(refunds ? 'modal.refund' : 'modal.noCharge')}</s-text>}
      </s-stack>
      <s-button
        slot="primary-action"
        tone="critical"
        loading={state === 'sending' || state === 'loading'}
        disabled={state === 'loading'}
        onClick={onCancel}
      >
        {t('modal.confirm')}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => shopify.close()}>
        {t('modal.keep')}
      </s-button>
    </s-customer-account-action>
  );
}
