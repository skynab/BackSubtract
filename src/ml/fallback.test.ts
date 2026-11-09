import { describe, expect, it, vi } from 'vitest';
import { type Fallback, ModelError, withFallbacks } from './fallback';

vi.spyOn(console, 'warn').mockImplementation(() => {});

/**
 * An attempt on a device that offers WebGPU: BiRefNet on the GPU, then IS-Net on the GPU,
 * then IS-Net on the CPU. It works once the given fallbacks are avoided.
 */
const worksAvoiding = (needed: Fallback[]) =>
  vi.fn(async (avoid: Fallback[]) => {
    if (needed.every((f) => avoid.includes(f))) return 'ok';
    throw new ModelError('failed', !avoid.includes('birefnet') ? 'birefnet' : !avoid.includes('gpu') ? 'gpu' : undefined);
  });

describe('withFallbacks', () => {
  it('makes no fallback when the first attempt works', async () => {
    const attempt = worksAvoiding([]);
    const retry = vi.fn();
    expect(await withFallbacks([], attempt, retry)).toEqual({ value: 'ok', fellBack: [] });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('falls back step by step until an attempt works, getting ready before each retry', async () => {
    const attempt = worksAvoiding(['birefnet', 'gpu']);
    const retry = vi.fn();
    expect(await withFallbacks([], attempt, retry)).toEqual({ value: 'ok', fellBack: ['birefnet', 'gpu'] });
    expect(attempt.mock.calls).toEqual([[[]], [['birefnet']], [['birefnet', 'gpu']]]);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('avoids what failed before, and reports only new fallbacks', async () => {
    const attempt = worksAvoiding(['birefnet', 'gpu']);
    expect(await withFallbacks(['birefnet'], attempt, () => {})).toEqual({ value: 'ok', fellBack: ['gpu'] });
    expect(attempt.mock.calls).toEqual([[['birefnet']], [['birefnet', 'gpu']]]);
  });

  it('when every attempt fails, throws the last error', async () => {
    const attempt = vi.fn(async (avoid: Fallback[]) => {
      throw new ModelError(`offline, avoiding ${avoid}`, avoid.includes('gpu') ? undefined : 'gpu');
    });
    await expect(withFallbacks(['birefnet'], attempt, () => {})).rejects.toThrow('offline, avoiding birefnet,gpu');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors, or a fallback already made', async () => {
    const cancelled = vi.fn(async () => {
      throw new Error('Cancelled');
    });
    await expect(withFallbacks([], cancelled, () => {})).rejects.toThrow('Cancelled');
    expect(cancelled).toHaveBeenCalledTimes(1);

    const again = vi.fn(async () => {
      throw new ModelError('still failing', 'gpu');
    });
    await expect(withFallbacks(['gpu'], again, () => {})).rejects.toThrow('still failing');
    expect(again).toHaveBeenCalledTimes(1);
  });
});
