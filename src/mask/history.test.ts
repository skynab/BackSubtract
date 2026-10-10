import { describe, expect, it } from 'vitest';
import { History, makeEdit } from './history';
import { Mask } from './mask';

function hide(mask: Mask, x: number, y: number) {
  const snapshot = mask.data.slice();
  const rect = { x, y, w: 1, h: 1 };
  const sel = new Uint8Array(mask.data.length);
  sel[y * mask.width + x] = 255;
  mask.apply(sel, rect, 'remove');
  return makeEdit(snapshot, mask, rect)!;
}

describe('History', () => {
  it('undoes and redoes edits in order', () => {
    const mask = new Mask(3, 1);
    const history = new History();
    history.push(hide(mask, 0, 0));
    history.push(hide(mask, 1, 0));
    expect([...mask.data]).toEqual([0, 0, 255]);

    history.undo(mask);
    expect([...mask.data]).toEqual([0, 255, 255]);
    history.undo(mask);
    expect([...mask.data]).toEqual([255, 255, 255]);
    expect(history.canUndo).toBe(false);

    history.redo(mask);
    expect([...mask.data]).toEqual([0, 255, 255]);
    expect(history.canRedo).toBe(true);
  });

  it('a new edit clears the redo stack', () => {
    const mask = new Mask(3, 1);
    const history = new History();
    history.push(hide(mask, 0, 0));
    history.undo(mask);
    history.push(hide(mask, 2, 0));
    expect(history.canRedo).toBe(false);
  });

  it('drops the oldest steps when over its memory budget, keeping the latest', () => {
    const mask = new Mask(3, 1);
    const history = new History(4); // each 1-pixel edit costs 2 bytes
    history.push(hide(mask, 0, 0));
    history.push(hide(mask, 1, 0));
    history.push(hide(mask, 2, 0));
    history.undo(mask);
    history.undo(mask);
    expect(history.canUndo).toBe(false);
    expect([...mask.data]).toEqual([0, 255, 255]);
  });

  it('discardLatest reverts the newest edit without allowing redo', () => {
    const mask = new Mask(3, 1);
    const history = new History();
    history.push({ ...hide(mask, 0, 0), tag: 7 });
    expect(history.latestTag).toBe(7);
    history.discardLatest(mask);
    expect([...mask.data]).toEqual([255, 255, 255]);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('latestTag is hidden once the edit is undone', () => {
    const mask = new Mask(3, 1);
    const history = new History();
    history.push({ ...hide(mask, 0, 0), tag: 3 });
    history.undo(mask);
    expect(history.latestTag).toBeUndefined();
  });

  it('newest() returns the most recent edits within a byte budget, oldest first', () => {
    const mask = new Mask(3, 1);
    const history = new History();
    const a = hide(mask, 0, 0), b = hide(mask, 1, 0), c = hide(mask, 2, 0);
    [a, b, c].forEach((e) => history.push(e));
    expect(history.newest(4)).toEqual([b, c]);
    const restored = new History();
    restored.restore(history.newest(100));
    expect(restored.canUndo).toBe(true);
  });

  it('goTo jumps several steps back and forward at once', () => {
    const mask = new Mask(3, 1);
    const history = new History();
    history.push({ ...hide(mask, 0, 0), label: { tool: 'wand', mode: 'remove' } });
    history.push({ ...hide(mask, 1, 0), label: { tool: 'brush', mode: 'remove' } });
    history.push(hide(mask, 2, 0));

    expect(history.goTo(mask, 1)).toEqual({ x: 1, y: 0, w: 2, h: 1 });
    expect([...mask.data]).toEqual([0, 255, 255]);
    expect(history.position).toBe(1);
    expect(history.steps).toEqual([
      { label: { tool: 'wand', mode: 'remove' }, applied: true },
      { label: { tool: 'brush', mode: 'remove' }, applied: false },
      { label: undefined, applied: false },
    ]);

    history.goTo(mask, 3);
    expect([...mask.data]).toEqual([0, 0, 0]);
    history.goTo(mask, 0);
    expect([...mask.data]).toEqual([255, 255, 255]);
    expect(history.goTo(mask, 0)).toBeNull();
  });

  it('makeEdit returns null when nothing changed', () => {
    const mask = new Mask(2, 2);
    expect(makeEdit(mask.data.slice(), mask, { x: 0, y: 0, w: 2, h: 2 })).toBeNull();
  });
});
