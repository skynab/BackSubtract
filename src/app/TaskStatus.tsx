import { useTranslation } from 'react-i18next';
import { cancelModelWork } from '../ml/client';
import { useUI } from '../state/store';

/** Shows slow work in progress (model downloads, AI processing) above the image. */
export function TaskStatus() {
  const { t } = useTranslation();
  const task = useUI((s) => s.task);
  if (!task) return null;
  return (
    <div className="task" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{t(task.key, task.params)}</span>
      {task.progress !== undefined && <progress value={task.progress} max={1} />}
      {/* Model downloads are large; let people on limited data stop them. */}
      {task.key === 'task.downloading' && (
        <button type="button" className="link" onClick={cancelModelWork}>
          {t('task.cancel')}
        </button>
      )}
    </div>
  );
}
