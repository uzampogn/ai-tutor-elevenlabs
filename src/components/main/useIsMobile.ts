import { useEffect, useState } from 'react';

/**
 * True when the viewport is at or below the mobile breakpoint (≤ 880px).
 * SSR-safe: `false` on the server and first client paint, then updated on mount
 * and on viewport changes. Desktop never flips to true, so mobile-only DOM (the
 * scrim) stays out of the desktop tree and the desktop render is unchanged.
 */
export function useIsMobile(query = '(max-width: 880px)'): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return isMobile;
}
