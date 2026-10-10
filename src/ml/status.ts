import { useUI } from '../state/store';
import { CancelledError, modelInfo, onDownloadProgress } from './client';
import type { ModelInfo, ModelName } from './protocol';

const MB = 1024 * 1024;

/** Show model downloads as progress in the task bar, switching to `nextKey` once the download completes. */
let afterDownload: { model: ModelName; key: string } | null = null;

onDownloadProgress((model, loaded, total) => {
  if (afterDownload?.model !== model) return;
  if (loaded >= total) {
    useUI.setState({ task: { key: afterDownload.key } });
  } else {
    useUI.setState({
      task: {
        key: 'task.downloading',
        params: { loaded: Math.round(loaded / MB), total: Math.round(total / MB) },
        progress: loaded / total,
      },
    });
  }
});

/** Look up (and remember) whether a model is downloaded and how big it is. */
export async function refreshModelInfo(model: ModelName): Promise<ModelInfo> {
  const info = await modelInfo(model);
  useUI.setState((s) => ({ models: { ...s.models, [model]: info } }));
  return info;
}

/**
 * Run a model task with progress shown: "Downloading… x / y MB" the first time,
 * then `workingKey` while it runs. Errors become a notice; returns null on failure.
 */
export async function withModelTask<T>(model: ModelName, workingKey: string, run: () => Promise<T>): Promise<T | null> {
  afterDownload = { model, key: workingKey };
  useUI.setState({ task: { key: workingKey } });
  try {
    const result = await run();
    void refreshModelInfo(model);
    return result;
  } catch (err) {
    if (err instanceof CancelledError) {
      useUI.getState().showNotice({ key: 'task.cancelled', tone: 'info' });
    } else {
      console.error(err);
      useUI.getState().showNotice({ key: 'errors.model', tone: 'error' });
    }
    return null;
  } finally {
    afterDownload = null;
    useUI.setState({ task: null });
  }
}
