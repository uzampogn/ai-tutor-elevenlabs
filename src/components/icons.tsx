// Inline SVG icon glyphs reconstructed from the mockup.
// All are decorative (aria-hidden); accessibility lives on the wrapping button.

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = (size: number): IconProps => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function RefreshIcon({ size = 14, ...rest }: IconProps & { size?: number }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function MicIcon({ size = 18, ...rest }: IconProps & { size?: number }) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  );
}

export function SendIcon({ size = 18, ...rest }: IconProps & { size?: number }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 12l16-8-6 16-3-7-7-1z" />
    </svg>
  );
}

export function SoundIcon({ size = 14, ...rest }: IconProps & { size?: number }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 8a5 5 0 0 1 0 8" />
    </svg>
  );
}

export function LinkIcon({ size = 13, ...rest }: IconProps & { size?: number }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8 8" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

export function CloseIcon({ size = 15, ...rest }: IconProps & { size?: number }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

export function CopyIcon({ size = 14, ...rest }: IconProps & { size?: number }) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function LikeIcon({ size = 14, ...rest }: IconProps & { size?: number }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M7 10v11" />
      <path d="M18 21H4V10l4-7a2 2 0 0 1 2-1c1.1 0 2 .9 2 2v4h6a2 2 0 0 1 2 2.3l-1.5 8A2 2 0 0 1 18 21z" />
    </svg>
  );
}

export function ArrowIcon({ size = 16, ...rest }: IconProps & { size?: number }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function PanelLeftIcon({ size = 16, ...rest }: IconProps & { size?: number }) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}
