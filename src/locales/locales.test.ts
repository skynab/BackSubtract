import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../i18n';

const dir = new URL('.', import.meta.url);
const load = (file: string) => JSON.parse(readFileSync(new URL(file, dir), 'utf-8'));

/** Every "a.b.c" key path with its string value. */
function flatten(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') for (const [kk, vv] of flatten(v as Record<string, unknown>, `${prefix}${k}.`)) out.set(kk, vv);
    else out.set(prefix + k, String(v));
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

const english = flatten(load('en.json'));
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('translations', () => {
  it('there is a file for every language in the picker, and no others', () => {
    expect(files.map((f) => f.replace('.json', '')).sort()).toEqual(LANGUAGES.map((l) => l.code).sort());
  });

  for (const file of files.filter((f) => f !== 'en.json')) {
    it(`${file} has exactly the same keys and placeholders as English`, () => {
      const other = flatten(load(file));
      expect([...other.keys()].sort()).toEqual([...english.keys()].sort());
      for (const [key, value] of english) {
        expect(placeholders(other.get(key)!), `${file}: ${key}`).toEqual(placeholders(value));
        expect(other.get(key)!.trim(), `${file}: ${key} is empty`).not.toBe('');
      }
    });
  }
});
