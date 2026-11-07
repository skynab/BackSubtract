import { useUI } from '../state/store';
import { CancelledError, modelInfo, onDownloadProgress } from './client';
import type { ModelInfo, ModelName } from './protocol';

/** Download sizes are shown in decimal megabytes, as Hugging Face and most systems list files. */
const MB = 1_000_000;
export const toMB = (bytes: number) => Math.round(bytes / MB);

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
        params: { loaded: toMB(loaded), total: toMB(total) },
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

/** Models the user agreed to download during this visit. A cancelled download is asked about again. */
const approved = new Set<ModelName>();

/** The answer to "Download the AI model?" while it's being asked. */
let pendingDownload: ((ok: boolean) => void) | null = null;

/** Ask (in the app's own dialog) before a model's first download. True if it's already downloaded or the user agrees. */
async function confirmDownload(model: ModelName): Promise<boolean> {
  if (approved.has(model)) return true;
  if ((await refreshModelInfo(model)).cached) return true;
  // Asking again replaces the earlier question, which counts as "Not now".
  pendingDownload?.(false);
  const ok = await new Promise<boolean>((resolve) => {
    pendingDownload = resolve;
    useUI.setState({ dialog: 'download', downloadModel: model });
  });
  if (ok) approved.add(model);
  return ok;
}

/** Called by the dialog with the user's answer. */
export function answerDownload(ok: boolean): void {
  const resolve = pendingDownload;
  pendingDownload = null;
  if (useUI.getState().dialog === 'download') useUI.setState({ dialog: null, downloadModel: null });
  resolve?.(ok);
}

/**
 * Run a model task with progress shown: "Downloading… x / y MB" the first time,
 * then `workingKey` while it runs. A model that isn't downloaded yet is asked
 * about first. Errors become a notice; returns null on failure or "Not now".
 */
export async function withModelTask<T>(model: ModelName, workingKey: string, run: () => Promise<T>): Promise<T | null> {
  try {
    if (!(await confirmDownload(model))) return null;
    afterDownload = { model, key: workingKey };
    useUI.setState({ task: { key: workingKey } });
    const result = await run();
    void refreshModelInfo(model);
    return result;
  } catch (err) {
    if (err instanceof CancelledError) {
      approved.delete(model);
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
