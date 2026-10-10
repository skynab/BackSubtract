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
export const LassoIcon = icon(
  <>
    <path d="M7.5 16.5C4.8 15.3 3 13.3 3 11c0-3.9 4-7 9-7s9 3.1 9 7-4 7-9 7c-1 0-2-.1-2.9-.4" />
    <circle cx="8.5" cy="17" r="1.6" />
    <path d="M8 18.5c-.4 1.2-1.3 2-2.5 2.2" />
  </>,
);
export const BrushIcon = icon(
  <>
    <path d="M20 4L11 13" />
    <path d="M10 13.5c-2 0-3.5 1.4-3.5 3.3 0 1.2-.8 2.2-2.5 2.7 4 1.1 8.2-.3 8.2-3.6z" />
  </>,
);
export const ShapeIcon = icon(
  <>
    <rect x="3.5" y="5.5" width="11" height="9" rx="1" strokeDasharray="2.5 2.5" />
    <ellipse cx="15" cy="15" rx="5.5" ry="4.5" />
  </>,
);
export const RectIcon = icon(<rect x="4" y="6" width="16" height="12" rx="1" />);
export const EllipseIcon = icon(<ellipse cx="12" cy="12" rx="8.5" ry="6.5" />);
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
export const CopyIcon = icon(
  <>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </>,
);
export const ShareIcon = icon(
  <>
    <path d="M12 15V4M8 7.5L12 3.5l4 4" />
    <path d="M8.5 10.5H7a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5a2 2 0 0 0-2-2h-1.5" />
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
export const HeartIcon = icon(
  <path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z" />,
);
export const CloseIcon = icon(<path d="M6 6l12 12M18 6L6 18" />);
export const ChevronIcon = icon(<path d="M7 10l5 5 5-5" />);
export const PlusIcon = icon(<path d="M12 6v12M6 12h12" />);
export const MinusIcon = icon(<path d="M6 12h12" />);
