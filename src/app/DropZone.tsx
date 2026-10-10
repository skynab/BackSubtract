import { useTranslation } from 'react-i18next';
import { chooseImage } from '../session/openImage';
import { ImageIcon } from './icons';

export function DropZone() {
  const { t } = useTranslation();
  return (
    <div className="dropzone">
      <ImageIcon className="dropzone-icon" />
      <h1>{t('empty.title')}</h1>
      <button type="button" className="primary large" onClick={chooseImage}>
        {t('empty.choose')}
      </button>
      <p className="muted">{t('empty.hint')}</p>
      <p className="muted small">{t('empty.privacy')}</p>
    </div>
  );
}
