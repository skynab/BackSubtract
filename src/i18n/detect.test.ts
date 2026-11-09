import { describe, expect, it } from 'vitest';
import { isRtl, pickLanguage } from './detect';

const supported = ['en', 'es', 'zh-CN'];

describe('pickLanguage', () => {
  it('prefers a saved choice', () => {
    expect(pickLanguage('es', ['en-US'], supported, 'en')).toBe('es');
  });
  it('ignores an unsupported saved choice', () => {
    expect(pickLanguage('xx', ['es-MX'], supported, 'en')).toBe('es');
  });
  it('matches exact codes before base languages', () => {
    expect(pickLanguage(null, ['zh-cn'], supported, 'en')).toBe('zh-CN');
    expect(pickLanguage(null, ['zh-TW'], supported, 'en')).toBe('zh-CN');
  });
  it('picks Simplified or Traditional Chinese by script and region', () => {
    const both = [...supported, 'zh-TW'];
    for (const pref of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-HK', 'zh-hant-tw']) {
      expect(pickLanguage(null, [pref], both, 'en'), pref).toBe('zh-TW');
    }
    for (const pref of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-HK']) {
      expect(pickLanguage(null, [pref], both, 'en'), pref).toBe('zh-CN');
    }
  });
  it('understands the old codes for Hebrew and Indonesian', () => {
    const more = [...supported, 'he', 'id'];
    expect(pickLanguage(null, ['iw-IL'], more, 'en')).toBe('he');
    expect(pickLanguage(null, ['iw'], more, 'en')).toBe('he');
    expect(pickLanguage(null, ['in-ID'], more, 'en')).toBe('id');
  });
  it('falls back', () => {
    expect(pickLanguage(null, ['de-DE'], supported, 'en')).toBe('en');
  });
});

describe('isRtl', () => {
  it('detects right-to-left languages', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('he-IL')).toBe(true);
    expect(isRtl('iw')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });
});
