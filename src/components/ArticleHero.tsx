'use client';

// The article's hero image. When it is missing or fails to load, the place is
// drawn (the mark at rest on the ground), never left blank.

import { useState } from 'react';
import Mark from './Mark';

interface ArticleHeroProps {
  src: string; // article.heroImage, '' when absent
  alt: string; // article title
}

export default function ArticleHero({ src, alt }: ArticleHeroProps) {
  const [failed, setFailed] = useState(false);
  const showImage = src !== '' && !failed;

  return (
    <div className="drawer-hero">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote og:image of unknown host; next/image needs a domain allowlist
        <img className="drawer-hero-img" src={src} alt={alt} onError={() => setFailed(true)} />
      ) : (
        <span className="ph-label">
          <Mark className="mark" size={22} />
          Article preview
        </span>
      )}
    </div>
  );
}
