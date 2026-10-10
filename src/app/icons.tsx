import type { ReactNode, SVGProps } from 'react';

function icon(paths: ReactNode) {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const AutoIcon = icon(
  <>
    <path d="M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6z" />
    <path d="M18 14l.8 2.2 2.2.8-2.2.8L18 20l-.8-2.2-2.2-.8 2.2-.8z" />
  </>,
);
export const SelectIcon = icon(<path d="M6 3l12 7-5.2 1.6L10.6 17z" />);
export const WandIcon = icon(
  <>
    <path d="M4 20L14.5 9.5" />
    <path d="M17 3v4M15 5h4M20 10v2M19 11h2M11 3v2M10 4h2" />
  </>,
);
export const ColorIcon = icon(<path d="M12 3.5c3.4 4 5.8 7.2 5.8 10a5.8 5.8 0 0 1-11.6 0c0-2.8 2.4-6 5.8-10z" />);
export const BrushIcon = icon(
  <>
    <path d="M20 4L11 13" />
    <path d="M10 13.5c-2 0-3.5 1.4-3.5 3.3 0 1.2-.8 2.2-2.5 2.7 4 1.1 8.2-.3 8.2-3.6z" />
  </>,
);
export const UndoIcon = icon(
  <>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>,
);
export const RedoIcon = icon(
  <>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </>,
);
export const DownloadIcon = icon(
  <>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
  </>,
);
export const ImageIcon = icon(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 17l4.5-4.5 4 4 2.5-2.5 5 5" />
  </>,
);
export const GlobeIcon = icon(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z" />
  </>,
);
export const ChevronIcon = icon(<path d="M7 10l5 5 5-5" />);
export const PlusIcon =icon(<path d="M12 6v12M6 12h12" />);
export const MinusIcon = icon(<path d="M6 12h12" />);
