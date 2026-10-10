import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage } from '../i18n';
import { GlobeIcon } from './icons';

export function TopBar() {
  const { t, i18n } = useTranslation();
  return (
    <header className="topbar">
      <div className="brand">
        <img src="/favicon.svg" alt="" width="26" height="26" />
        <span>BackSubtract</span>
      </div>
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
    </header>
  );
}
