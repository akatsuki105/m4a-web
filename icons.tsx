// アイコン (依存を増やさないよう SVG を手で書く). 大きさは size, 色は文字の色 (currentColor)

import type { FunctionComponent, JSX } from "preact";

type IconProps = { size?: number };

const svg = (paths: JSX.Element, fill = true): FunctionComponent<IconProps> => ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"}
    stroke-width={fill ? undefined : 2}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {paths}
  </svg>
);

export const PlayIcon = svg(<path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.98-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" />);
export const PauseIcon = svg(
  <>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </>,
);
export const NextIcon = svg(
  <>
    <path d="M5 6.2v11.6a1 1 0 0 0 1.53.85l9.07-5.8a1 1 0 0 0 0-1.7L6.53 5.35A1 1 0 0 0 5 6.2z" />
    <rect x="17" y="5" width="2.5" height="14" rx="1" />
  </>,
);
export const PrevIcon = svg(
  <>
    <path d="M19 6.2v11.6a1 1 0 0 1-1.53.85l-9.07-5.8a1 1 0 0 1 0-1.7l9.07-5.8A1 1 0 0 1 19 6.2z" />
    <rect x="4.5" y="5" width="2.5" height="14" rx="1" />
  </>,
);
export const ShuffleIcon = svg(
  <>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="M15 15l6 6" />
    <path d="M4 4l5 5" />
  </>,
  false,
);
export const RepeatIcon = svg(
  <>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </>,
  false,
);
export const RepeatOneIcon = svg(
  <>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    <path d="M11 10h1v4" />
  </>,
  false,
);
export const VolumeIcon = svg(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </>,
  false,
);
export const MuteIcon = svg(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="M22 9l-6 6" />
    <path d="M16 9l6 6" />
  </>,
  false,
);
export const GearIcon = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
  false,
);
export const MoreIcon = svg(
  <>
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </>,
);
export const PlusIcon = svg(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
  false,
);
export const CloseIcon = svg(
  <>
    <path d="M18 6 6 18" />
    <path d="M6 6l12 12" />
  </>,
  false,
);
export const MusicIcon = svg(
  <>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </>,
  false,
);
export const CartridgeIcon = svg(
  <>
    <path d="M5 3h11l3 3v15H5z" />
    <rect x="8" y="7" width="8" height="6" rx="1" />
    <path d="M8 17v2M11 17v2M14 17v2" />
  </>,
  false,
);
export const VisualizerIcon = svg(
  <>
    <path d="M4 20V10" />
    <path d="M9 20V4" />
    <path d="M14 20v-7" />
    <path d="M19 20V8" />
  </>,
  false,
);
export const DownloadIcon = svg(
  <>
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  </>,
  false,
);
