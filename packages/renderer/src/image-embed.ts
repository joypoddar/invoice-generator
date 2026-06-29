import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve an image URL/path into something an `<img src>` can render.
 * - http(s):// URLs pass through unchanged.
 * - data: URLs pass through (already inline).
 * - file:// or absolute/relative paths are read and base64-embedded so the
 *   document doesn't depend on an external fetch (works offline, in email, and
 *   when the PDF is saved).
 * - Returns null when the path is invalid or unreadable (caller omits the
 *   image). Shared by the logo (voucher) and signature (invoice) renderers.
 */
export function resolveImageSrc(urlOrPath: string): string | null {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  if (urlOrPath.startsWith('data:')) return urlOrPath;
  const path = urlOrPath.startsWith('file://') ? fileURLToPath(urlOrPath) : urlOrPath;
  try {
    const buf = readFileSync(path);
    const ext = extname(path).toLowerCase();
    const mime =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.svg'
          ? 'image/svg+xml'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.webp'
              ? 'image/webp'
              : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
