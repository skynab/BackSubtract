import { describe, expect, it } from 'vitest';
import { historyBudget } from './memory';

const MB = 1024 * 1024;

describe('historyBudget', () => {
  it('scales with reported memory, within limits', () => {
    expect(historyBudget({ deviceMemory: 8, ios: false })).toBe(256 * MB);
    expect(historyBudget({ deviceMemory: 4, ios: false })).toBe(128 * MB);
    expect(historyBudget({ deviceMemory: 2, ios: false })).toBe(64 * MB);
    expect(historyBudget({ deviceMemory: 0.5, ios: false })).toBe(48 * MB);
  });

  it('is smaller on iPhones and iPads, which do not report memory', () => {
    expect(historyBudget({ ios: true })).toBe(96 * MB);
  });

  it('keeps the full amount where nothing is known and it is not iOS', () => {
    expect(historyBudget({ ios: false })).toBe(256 * MB);
  });
});
