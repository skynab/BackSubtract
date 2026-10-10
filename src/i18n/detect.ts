const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

const base = (code: string) => code.toLowerCase().split('-')[0];

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
  for (const pref of preferred) {
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
