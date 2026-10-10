import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { isRtl, pickLanguage } from './detect';

/** Languages offered in the top bar, each labelled in its own language. */
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
] as const;

const FALLBACK = 'en';
const STORAGE_KEY = 'backsubtract.lang';

// Each language file is its own chunk, loaded only when that language is used.
const bundles = import.meta.glob<{ default: Record<string, unknown> }>('../locales/*.json');

async function loadBundle(code: string): Promise<void> {
  if (i18n.hasResourceBundle(code, 'translation')) return;
  const load = bundles[`../locales/${code}.json`];
  if (!load) throw new Error(`No translations for ${code}`);
  i18n.addResourceBundle(code, 'translation', (await load()).default);
}

function applyToDocument(code: string): void {
  document.documentElement.lang = code;
  document.documentElement.dir = isRtl(code) ? 'rtl' : 'ltr';
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function initI18n(): Promise<void> {
  const code = pickLanguage(
    readSaved(),
    navigator.languages?.length ? navigator.languages : [navigator.language],
    LANGUAGES.map((l) => l.code),
    FALLBACK,
  );
  await i18n.use(initReactI18next).init({
    lng: code,
    fallbackLng: FALLBACK,
    resources: {},
    partialBundledLanguages: true,
    interpolation: { escapeValue: false },
  });
  await Promise.all([loadBundle(FALLBACK), loadBundle(code)]);
  await i18n.changeLanguage(code);
  applyToDocument(code);
}

export async function setLanguage(code: string): Promise<void> {
  await loadBundle(code);
  await i18n.changeLanguage(code);
  applyToDocument(code);
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage can be unavailable (private mode); the choice just won't be remembered.
  }
}

export { i18n };
