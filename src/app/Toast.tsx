import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUI } from '../state/store';

const VISIBLE_MS = 6000;

export function Toast() {
  const { t } = useTranslation();
  const notice = useUI((s) => s.notice);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => useUI.getState().clearNotice(), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className={`toast ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <span>{t(notice.key, notice.params)}</span>
      <button type="button" className="link" onClick={() => useUI.getState().clearNotice()}>
        {t('dismiss')}
      </button>
    </div>
  );
}
