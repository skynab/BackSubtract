const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

/** Old ISO codes some browsers still report (older Android and Java-based ones): iw for Hebrew, in for Indonesian. */
const LEGACY: Record<string, string> = { iw: 'he', in: 'id' };

const base = (code: string) => {
  const b = code.toLowerCase().split('-')[0];
  return LEGACY[b] ?? b;
};

const TRADITIONAL_REGIONS = ['tw', 'hk', 'mo'];

/**
 * Chinese is matched by script, not region: Traditional (zh-TW) for an explicit
 * "Hant" or for Taiwan, Hong Kong and Macau; Simplified (zh-CN) otherwise.
 */
function byScript(code: string): string {
  const parts = code.toLowerCase().split('-');
  if (parts[0] !== 'zh') return code;
  const traditional = parts.includes('hant') || (!parts.includes('hans') && parts.some((p) => TRADITIONAL_REGIONS.includes(p)));
  return traditional ? 'zh-TW' : 'zh-CN';
}

/**
 * Choose the UI language: a saved choice wins, then the browser's preferred
 * languages (exact match first, then same base language), then the fallback.
 */
export function pickLanguage(
  saved: string | null,
  preferred: readonly string[],
  supported: readonly string[],
  fallback: string,
): string {
  if (saved && supported.includes(saved)) return saved;
  for (const pref of preferred.map(byScript)) {
    const exact = supported.find((s) => s.toLowerCase() === pref.toLowerCase());
    if (exact) return exact;
    const sameBase = supported.find((s) => base(s) === base(pref));
    if (sameBase) return sameBase;
  }
  return fallback;
}

export function isRtl(code: string): boolean {
  return RTL_LANGUAGES.has(base(code));
}
