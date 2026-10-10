import { useTranslation } from 'react-i18next';
import { DONATE_CURRENCY, DONATE_OPTIONS } from '../config';
import { HeartIcon } from './icons';
import { Modal } from './Modal';

export const canDonate = DONATE_OPTIONS.length > 0;

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
      <p className="muted small">{t('donate.note')}</p>
    </Modal>
  );
}
