import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { openItem, runQueue } from '../batch/batch';
import { useBatch, type BatchItem } from '../batch/state';
import { refreshModelInfo, toMB } from '../ml/status';
import { chooseImages } from '../session/open';
import { useUI } from '../state/store';
import { DownloadButton } from './DownloadButton';
import { AutoIcon, CloseIcon, ImageIcon } from './icons';
import { TaskStatus } from './TaskStatus';

function Tile({ item }: { item: BatchItem }) {
  const { t } = useTranslation();
  const status = item.status === 'done' && item.edited ? 'edited' : item.status;
  const label = t(`batch.status.${status}`);
  return (
    <li className="batch-cell">
      <button
        type="button"
        className={`batch-item ${item.status}`}
        // Its result is on its way; it opens once that's in.
        disabled={item.status === 'running'}
        aria-label={t('batch.item', { name: item.fileName, status: label })}
        title={item.fileName}
        onClick={() => void openItem(item.id)}
      >
        {item.thumb && <img src={item.thumb} alt="" draggable={false} />}
        {item.status === 'running' && <span className="spinner" aria-hidden="true" />}
        {status !== 'done' && (
          <span className="batch-chip" aria-hidden="true">
            {label}
          </span>
        )}
      </button>
      <span className="batch-name" dir="auto" aria-hidden="true">
        {item.fileName}
      </span>
    </li>
  );
}

/** Starts Auto on the waiting images when it didn't start by itself: its model isn't downloaded yet, or it was stopped. */
function RunButton() {
  const { t } = useTranslation();
  const info = useUI((s) => s.models.auto);
  useEffect(() => {
    if (!info) void refreshModelInfo('auto').catch(() => {});
  }, [info]);
  return (
    <button type="button" className="secondary" onClick={() => void runQueue(true)}>
      <AutoIcon width={18} height={18} />
      {info && !info.cached ? t('batch.runDownload', { size: toMB(info.bytes) }) : t('batch.run')}
    </button>
  );
}

/** The grid of a batch's images, each showing its result, or that it's waiting or being worked on. */
export function BatchView() {
  const { t } = useTranslation();
  const items = useBatch((s) => s.items);
  const adding = useBatch((s) => s.adding);
  const running = useBatch((s) => s.running);
  const busy = useUI((s) => s.task !== null);
  const done = items.filter((i) => i.status === 'done').length;
  const waiting = items.some((i) => i.status === 'waiting');

  return (
    <section className="batch" aria-label={t('batch.label')}>
      <div className="batch-head">
        <p className="batch-progress">{t('batch.progress', { done, total: items.length + adding })}</p>
        {waiting && !running && !busy && <RunButton />}
        <TaskStatus inline />
      </div>
      <ul className="batch-grid">
        {items.map((item) => (
          <Tile key={item.id} item={item} />
        ))}
        {Array.from({ length: adding }, (_, i) => (
          <li key={`adding-${i}`} className="batch-cell">
            <div className="batch-item adding">
              <span className="spinner" aria-hidden="true" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The bottom bar under the grid: add images, close the batch, and download them all. */
export function BatchBar() {
  const { t } = useTranslation();
  return (
    <footer className="bottombar batch-bar">
      <div className="actions">
        <button type="button" className="icon" title={t('batch.add')} aria-label={t('batch.add')} onClick={chooseImages}>
          <ImageIcon />
        </button>
        <button
          type="button"
          className="icon"
          title={t('batch.close')}
          aria-label={t('batch.close')}
          onClick={() => useUI.setState({ dialog: 'closeBatch' })}
        >
          <CloseIcon />
        </button>
        <DownloadButton batch />
      </div>
    </footer>
  );
}
