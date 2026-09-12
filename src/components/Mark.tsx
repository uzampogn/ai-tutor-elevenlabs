// The proposed mark: one 4-point sparkle, the single glyph the pinned palette
// carries. Proposed inside the redesign, never presented as established — the
// wordmark waits for the naming session (PRODUCT.md → Brand Commitments).

import type { SVGProps } from 'react';

export default function Mark({ size = 18, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...rest}
    >
      <path d="M12 1.5c.55 6.3 3.4 9.15 9.7 9.7-6.3.55-9.15 3.4-9.7 9.7-.55-6.3-3.4-9.15-9.7-9.7 6.3-.55 9.15-3.4 9.7-9.7Z" />
    </svg>
  );
}
