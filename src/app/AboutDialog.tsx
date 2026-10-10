import { useTranslation } from 'react-i18next';
import { CONTACT_EMAIL, SOURCE_URL } from '../config';
import { CREDITS } from './credits';
import { Modal } from './Modal';

const SHORTCUTS: [string, string][] = [
  ['1 – 4, B, M', 'shortcuts.tools'],
  ['Shift', 'shortcuts.square'],
  ['X', 'shortcuts.mode'],
  ['[  ]', 'shortcuts.size'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'shortcuts.undo'],
  ['Space + drag', 'shortcuts.pan'],
  ['0', 'shortcuts.fit'],
  ['C', 'shortcuts.compare'],
  ['V', 'shortcuts.view'],
];

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal title={t('about.title')} onClose={onClose}>
      <p>{t('about.intro')}</p>
      <p>{t('about.privacy')}</p>

      <h3>{t('about.shortcutsTitle')}</h3>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{t(label)}</dd>
          </div>
        ))}
      </dl>

      <h3>{t('about.creditsTitle')}</h3>
      <ul className="credits">
        {CREDITS.map((c) => (
          <li key={c.name}>
            <a href={c.url} target="_blank" rel="noopener noreferrer">
              {c.name}
            </a>{' '}
            <span className="muted">({c.license})</span>
          </li>
        ))}
      </ul>

      <p className="muted small">
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          {t('about.source')}
        </a>
        {CONTACT_EMAIL && (
          <>
            {' · '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{t('about.contact')}</a>
          </>
        )}
      </p>
    </Modal>
  );
}
