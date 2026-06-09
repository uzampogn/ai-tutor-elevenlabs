// Presentational helpers for the knowledge-base cards.

/**
 * Article has no category field, so we derive a presentational category + color
 * per article by rotating a small fixed palette by the article's list index.
 * This is purely cosmetic (the dot/label colour and label text in each KbCard).
 */
const PALETTE: { name: string; color: string }[] = [
  { name: 'RESEARCH', color: 'oklch(0.55 0.16 28)' }, // terracotta-red
  { name: 'PRODUCT', color: 'oklch(0.58 0.13 150)' }, // green
  { name: 'POLICY', color: 'oklch(0.55 0.14 260)' }, // blue
  { name: 'SOCIETY', color: 'oklch(0.6 0.14 80)' }, // amber
];

export function categoryFor(index: number): { name: string; color: string } {
  return PALETTE[index % PALETTE.length];
}

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

/** Format an ISO pubDate to the short mono form, e.g. "JUN 03". */
export function formatShortDate(pubDate: string): string {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${day}`;
}
