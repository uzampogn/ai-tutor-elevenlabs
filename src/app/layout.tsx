import type { Metadata, Viewport } from 'next';
import './globals.css';

// Google Sans Flex is the single family (PRODUCT.md, decision 1 in the shape
// brief). next/font/google in Next 14.2 does not list it, so it loads through
// the CSS2 API and `globals.css` names the family directly on <html> — no
// CSS-variable hand-off between :root and body, which is what silently dropped
// every custom face in the previous design.
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,300..800&display=swap';

export const metadata: Metadata = {
  title: 'AI News Tutor',
  description: 'Learn the latest AI developments from the Claude blog — key concepts, business impact, Q&A.',
};

// Daylight, half-attending scene (shape brief): a light ground only. Declaring
// color-scheme here emits the <meta> so the browser never paints dark canvas or
// scrollbars in OS dark mode, even before the stylesheet arrives.
export const viewport: Viewport = {
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- family absent from next/font/google 14.2 */}
        <link rel="stylesheet" href={FONT_HREF} />
      </head>
      <body>{children}</body>
    </html>
  );
}
