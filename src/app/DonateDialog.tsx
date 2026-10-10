import { useTranslation } from 'react-i18next';
import { DONATE_CURRENCY, DONATE_OPTIONS } from '../config';
import { HeartIcon } from './icons';
import { Modal } from './Modal';

/** Whether donations are set up. Without payment links the button stays hidden, except while developing. */
export const canDonate = DONATE_OPTIONS.length > 0;
export const showDonate = canDonate || import.meta.env.DEV;

/**
 * The site's own donation dialog. Payment itself happens on Stripe's hosted page
 * (opened in a new tab), so the site never handles card details.
 */
export function DonateDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const money = new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: 'currency',
    currency: DONATE_CURRENCY,
    maximumFractionDigits: 0,
  });

  return (
    <Modal title={t('donate.title')} onClose={onClose}>
      <HeartIcon className="donate-heart" />
      <p>{t('donate.body')}</p>
      <div className="donate-options">
        {DONATE_OPTIONS.map((o) => (
          <a
            key={o.url}
            className={o.amount ? 'primary' : 'secondary'}
            href={o.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
          >
            {o.amount ? money.format(o.amount) : t('donate.other')}
          </a>
        ))}
      </div>
      {canDonate ? (
        <p className="muted small">{t('donate.note')}</p>
      ) : (
        // Only reachable in development: tell the developer what to configure. Not translated on purpose.
        <p className="muted small">
          No payment links are set, so this button is hidden on the live site. Add <code>VITE_DONATE_LINK_*</code> to{' '}
          <code>.env.local</code> (see <code>.env.example</code>).
        </p>
      )}
    </Modal>
  );
}
