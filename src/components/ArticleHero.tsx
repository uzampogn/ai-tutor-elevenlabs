'use client';

import { useState, type CSSProperties } from 'react';

interface ArticleHeroProps {
  src: string; // article.heroImage, '' when absent
  alt: string; // article title
  accentColor: string; // category color driving the gradient fallback
}

export default function ArticleHero({ src, alt, accentColor }: ArticleHeroProps) {
  const [failed, setFailed] = useState(false);
  const showImage = src !== '' && !failed;

  // Expose the category color to CSS for the tinted gradient fallback.
  const style = { '--hero-accent': accentColor } as CSSProperties;

  return (
    <div className="drawer-hero" style={style}>
      {showImage ? (
        <img className="drawer-hero-img" src={src} alt={alt} onError={() => setFailed(true)} />
      ) : (
        <span className="ph-label">Article preview</span>
      )}
    </div>
  );
}
