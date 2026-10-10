import { describe, expect, it } from 'vitest';
import { History, makeEdit } from './history';
import { Mask } from './mask';

function hide(mask: Mask, x: number, y: number) {
  const snapshot = mask.data.slice();
  const rect = { x, y, w: 1, h: 1 };
  mask.apply(new Uint8Array([255]), rect, 'remove');
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

  it('makeEdit returns null when nothing changed', () => {
    const mask = new Mask(2, 2);
    expect(makeEdit(mask.data.slice(), mask, { x: 0, y: 0, w: 2, h: 2 })).toBeNull();
  });
});
