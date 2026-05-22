/**
 * Slugify a string for use in a filename. Lowercase, whitespace and other
 * separators become `_`, dashes/dots are preserved, anything else is dropped.
 * Used to build the `<title>` tag that drives browser PDF-filename suggestions.
 *
 *   "John Doe"          -> "john_doe"
 *   "Café Müller"       -> "caf_m_ller"   (non-ASCII letters dropped)
 *   "CRE-2026-0001"     -> "cre-2026-0001"  (dashes preserved)
 *   "  Trailing  "      -> "trailing"
 *   "Acme, Inc."        -> "acme_inc."
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_]+|[_]+$/g, '');
}
