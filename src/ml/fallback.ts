/**
 * Something that failed on this device: BiRefNet (IS-Net is used instead), or the
 * GPU (the models run on the CPU instead).
 */
export type Fallback = 'birefnet' | 'gpu';

/** An AI call that failed, with the fallback that might make it work. */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly fallback?: Fallback,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

/**
 * Runs `attempt`, avoiding what failed before, and each time it fails with a fallback
 * not tried yet, calls `beforeRetry` and tries again with that avoided too. Returns the
 * fallbacks made once an attempt works; if none does (e.g. offline, so every download
 * failed), throws the last error, and nothing is to be remembered against the device.
 */
export async function withFallbacks<T>(
  avoid: Fallback[],
  attempt: (avoid: Fallback[]) => Promise<T>,
  beforeRetry: () => void,
): Promise<{ value: T; fellBack: Fallback[] }> {
  const fellBack: Fallback[] = [];
  for (;;) {
    try {
      return { value: await attempt([...avoid, ...fellBack]), fellBack };
    } catch (err) {
      const fallback = err instanceof ModelError ? err.fallback : undefined;
      if (!fallback || avoid.includes(fallback) || fellBack.includes(fallback)) throw err;
      console.warn(fallback === 'gpu' ? 'The AI model failed on the GPU; trying the CPU.' : 'BiRefNet failed; trying IS-Net.', err);
      fellBack.push(fallback);
      beforeRetry();
    }
  }
}
