const MB = 1024 * 1024;

/** The most undo history kept anywhere (desktops with plenty of memory). */
const MAX_HISTORY = 256 * MB;
/** The least, so a few whole-image steps (Auto, Edges) can always be undone. */
const MIN_HISTORY = 48 * MB;
/** iPhones and iPads don't report their memory, and Safari closes tabs that use too much. */
const IOS_HISTORY = 96 * MB;

export interface DeviceHints {
  /** navigator.deviceMemory: approximate RAM in GB (Chromium browsers only; capped at 8). */
  deviceMemory?: number;
  ios: boolean;
}

/**
 * How much memory undo history may use on this device. The open photo itself
 * takes a few hundred MB at the largest size (pixels, a copy for the workers,
 * the screen texture and the mask), so history gets a share that fits beside it:
 * 32 MB per GB of memory, between 48 and 256 MB.
 */
export function historyBudget({ deviceMemory, ios }: DeviceHints): number {
  if (deviceMemory) return Math.min(MAX_HISTORY, Math.max(MIN_HISTORY, deviceMemory * 32 * MB));
  return ios ? IOS_HISTORY : MAX_HISTORY;
}

/** What this browser says about the device. */
export function deviceHints(): DeviceHints {
  if (typeof navigator === 'undefined') return { ios: false };
  const nav = navigator as Navigator & { deviceMemory?: number };
  // iPadOS reports itself as a Mac; touch support gives it away.
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return { deviceMemory: nav.deviceMemory, ios };
}
