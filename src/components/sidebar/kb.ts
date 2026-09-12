// Presentational helpers for the knowledge-base rows.

/**
 * Article has no category field, so a presentational category label is derived
 * by rotating a small fixed list by the article's list index. Text only — the
 * category colours were dropped (shape brief §7, decision 4).
 */
const CATEGORIES = ['Research', 'Product', 'Policy', 'Society'];

export function categoryFor(index: number): string {
  return CATEGORIES[index % CATEGORIES.length];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format an ISO pubDate to the short form used in rows and the drawer, e.g. "3 Jun". */
export function formatShortDate(pubDate: string): string {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
