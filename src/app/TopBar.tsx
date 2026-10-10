import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage } from '../i18n';
import { useUI } from '../state/store';
import { showDonate } from './DonateDialog';
import { GlobeIcon, HeartIcon } from './icons';

export function TopBar() {
  const { t, i18n } = useTranslation();
  return (
    <header className="topbar">
      {/* The name doubles as the way into About, so it needs no button of its own. */}
      <button type="button" className="brand" title={t('about.title')} onClick={() => useUI.setState({ dialog: 'about' })}>
        <img src="/favicon.svg" alt="" width="26" height="26" />
        <span>BackSubtract</span>
      </button>
      <div className="topbar-end">
        <label className="language">
          <GlobeIcon />
          <span className="sr-only">{t('language')}</span>
          <select value={i18n.resolvedLanguage} onChange={(e) => void setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        {showDonate && (
          <button
            type="button"
            className="donate-button"
            aria-label={t('donate.button')}
            title={t('donate.button')}
            onClick={() => useUI.setState({ dialog: 'donate' })}
          >
            <HeartIcon width={18} height={18} />
            <span>{t('donate.button')}</span>
          </button>
        )}
      </div>
    </header>
  );
}
