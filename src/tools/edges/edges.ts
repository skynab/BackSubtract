import { adjustInWorker } from '../../cv/client';
import { editor } from '../../editor/editor';
import { isNoAdjust, type EdgeAdjust } from '../../mask/adjust';

/**
 * The Edges panel's live adjustment. While the panel is open, every slider
 * move re-runs the adjustment on the mask as it was when the panel opened and
 * replaces one history step, so the settings never compound. Work runs in the
 * image worker; moves made while it is busy are coalesced into one more run.
 */
interface Session {
  /** Identifies this session to the worker, which keeps work that depends only on `base`. */
  key: number;
  base: Uint8Array;
  image: ImageBitmap;
  tag: number | null;
  /** History version after our last change; anything else changing it ends the session. */
  version: number;
}

let session: Session | null = null;
let nextKey = 1;
let running = false;
/** Set while this module changes the mask, so its own history event doesn't look like an outside change. */
let applying = false;
let queued: EdgeAdjust | null = null;

/** Start adjusting from the current mask. */
export function beginEdges(): void {
  if (!editor.mask || !editor.image) return;
  session = { key: nextKey++, base: editor.mask.data.slice(), image: editor.image, tag: null, version: editor.history.version };
}

export function endEdges(): void {
  session = null;
  queued = null;
}

/** Whether the mask changed some other way (undo, another tool, a new image) since the panel last touched it. */
export function edgesStale(): boolean {
  if (applying) return false;
  return !session || editor.image !== session.image || editor.history.version !== session.version;
}

/** Apply these settings (replacing the previous ones). */
export async function setEdges(adjust: EdgeAdjust): Promise<void> {
  if (running) {
    queued = adjust;
    return;
  }
  const s = session;
  if (!s || edgesStale()) return;
  running = true;
  try {
    const values = isNoAdjust(adjust) ? s.base : await adjustInWorker(s.base, adjust, s.key);
    if (session !== s || editor.image !== s.image || editor.history.version !== s.version) return;
    applying = true;
    try {
      s.tag = editor.replaceMask(values, { tool: 'edges' }, s.tag ?? undefined);
    } finally {
      applying = false;
    }
    s.version = editor.history.version;
  } catch (err) {
    console.error(err);
  } finally {
    running = false;
  }
  if (queued) {
    const next = queued;
    queued = null;
    await setEdges(next);
  }
}
