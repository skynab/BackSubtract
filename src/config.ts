/**
 * Site settings that come from the deployment, not the code. Set them in a
 * `.env.local` file (see `.env.example`) or in the host's environment variables.
 * Anything left empty is simply hidden.
 */
const env = import.meta.env;

export interface DonateOption {
  /** Amount in whole currency units, e.g. 5 for $5. Absent for "other amount". */
  amount?: number;
  /** A Stripe Payment Link (https://buy.stripe.com/...). */
  url: string;
}

const preset = (amount: number, url: string | undefined): DonateOption[] => (url ? [{ amount, url }] : []);

/** Donation buttons, in order. Each is a Stripe Payment Link made in the Stripe dashboard. */
export const DONATE_OPTIONS: DonateOption[] = [
  ...preset(3, env.VITE_DONATE_LINK_3),
  ...preset(5, env.VITE_DONATE_LINK_5),
  ...preset(10, env.VITE_DONATE_LINK_10),
  ...(env.VITE_DONATE_LINK_CUSTOM ? [{ url: env.VITE_DONATE_LINK_CUSTOM as string }] : []),
];

/** ISO currency of the preset amounts, used only to display them. */
export const DONATE_CURRENCY: string = env.VITE_DONATE_CURRENCY || 'USD';

/** Public contact address, shown on the About page (Stripe requires one for payments). */
export const CONTACT_EMAIL: string = env.VITE_CONTACT_EMAIL || '';

/** Link to the source code, shown on the About page. */
export const SOURCE_URL: string = env.VITE_SOURCE_URL || 'https://github.com/skynab/BackSubtract';
