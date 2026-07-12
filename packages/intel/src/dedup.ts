/**
 * Content deduplication module.
 * Ported from MarketFeeds — uses URL normalization and
 * Levenshtein distance for fuzzy title matching.
 *
 * No crypto dependency — uses a simple string hash for React Native.
 */

/**
 * Generate a simple hash string from title + URL.
 * Uses djb2 algorithm — fast, deterministic, collision-resistant enough
 * for our small dataset (< 200 items).
 */
export function generateContentHash(title: string, url: string): string {
  const normalized = `${normalizeText(title)}|${normalizeUrl(url)}`;
  return djb2Hash(normalized);
}

/**
 * Simple djb2 hash — fast, no native deps.
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // Convert to unsigned 32-bit then hex string
  return (hash >>> 0).toString(16);
}

/**
 * Normalize text for hashing — lowercase, strip punctuation, collapse whitespace.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize URL for deduplication.
 *
 * Special handling for Google redirect URLs:
 * Google Alerts links look like:
 *   https://www.google.com/url?rct=j&sa=t&url=https://actual-article.com/path&ct=ga&...
 *
 * Without special handling, normalizing strips all query params and
 * every link collapses to "www.google.com/url" — killing all but 1 item.
 *
 * Fix: Extract the actual target URL from the `url` query parameter.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);

    // Handle Google redirect URLs — extract the real destination
    if (
      (u.hostname.includes('google.com') ||
        u.hostname.includes('google.co.in') ||
        u.hostname.includes('google.co.uk')) &&
      u.pathname === '/url'
    ) {
      const realUrl = u.searchParams.get('url') || u.searchParams.get('q');
      if (realUrl) {
        try {
          const real = new URL(realUrl);
          return `${real.hostname}${real.pathname}`
            .replace(/\/+$/, '')
            .toLowerCase();
        } catch {
          // If the extracted URL is invalid, use it as-is
          return realUrl.toLowerCase().trim();
        }
      }
    }

    // For non-Google URLs, strip query params but keep path
    return `${u.hostname}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * Levenshtein distance for fuzzy title matching.
 * Used to detect near-duplicate titles from different sources.
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if two titles are similar enough to be near-duplicates.
 * Uses normalized Levenshtein distance.
 *
 * Threshold is 30% — relaxed from the original 15% to better handle
 * Google Alerts content where similar headlines from different sources
 * are genuinely different articles covering the same event.
 */
export function areTitlesSimilar(
  a: string,
  b: string,
  threshold = 0.30,
): boolean {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  const maxLen = Math.max(normA.length, normB.length);

  if (maxLen === 0) {
    return true;
  }

  // Short titles need exact matching — fuzzy matching is unreliable
  if (maxLen < 20) {
    return normA === normB;
  }

  const distance = levenshteinDistance(normA, normB);
  return distance / maxLen <= threshold;
}

/**
 * Deduplicate feed items by link (exact) and title (fuzzy).
 * Items with the same normalized URL are exact duplicates.
 * Items with similar titles (< 30% Levenshtein distance) are near-duplicates.
 *
 * Returns deduplicated items.
 */
export function deduplicateItems<
  T extends {link: string; title: string},
>(items: T[]): T[] {
  const seen = new Map<string, number>(); // normalizedUrl → index
  const result: T[] = [];

  for (const item of items) {
    const normUrl = normalizeUrl(item.link);

    // Exact URL duplicate check
    if (seen.has(normUrl)) {
      console.log(
        `[Dedup] Skipping URL duplicate: "${item.title.substring(0, 50)}..."`,
      );
      continue;
    }

    // Fuzzy title check against existing results
    let isDupe = false;
    for (const existing of result) {
      if (areTitlesSimilar(item.title, existing.title)) {
        console.log(
          `[Dedup] Skipping fuzzy duplicate: "${item.title.substring(0, 50)}..." ≈ "${existing.title.substring(0, 50)}..."`,
        );
        isDupe = true;
        break;
      }
    }

    if (!isDupe) {
      seen.set(normUrl, result.length);
      result.push(item);
    }
  }

  console.log(
    `[Dedup] ${items.length} items → ${result.length} after dedup (removed ${items.length - result.length})`,
  );

  return result;
}
