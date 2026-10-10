import { useTranslation } from 'react-i18next';
import { useUI, VIEW_MODES } from '../state/store';

/** Switch between the result, the result over a faint original, and the original itself. */
export function ViewSwitch() {
  const { t } = useTranslation();
  const viewMode = useUI((s) => s.viewMode);
  return (
    <div className="segmented view-switch" role="group" aria-label={t('view.label')}>
      {VIEW_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={viewMode === mode}
          title={t(`view.hints.${mode}`)}
          onClick={() => useUI.setState({ viewMode: mode })}
        >
          {t(`view.${mode}`)}
        </button>
      ))}
    </div>
  );
}
