/**
 * Subsequence matching for the command palette and quick open.
 *
 * Returns a score plus the indices that matched, so the caller can highlight
 * them, or null when the needle is not a subsequence of the haystack.
 */
export function fuzzyMatch(haystack, needle) {
  const text = String(haystack || '');
  const query = String(needle || '');
  if (!query) return { score: 0, indices: [] };

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  const indices = [];
  let score = 0;
  let position = 0;
  let previous = -1;

  for (const char of lowerQuery) {
    const index = lowerText.indexOf(char, position);
    if (index === -1) return null;
    indices.push(index);
    score += 1;
    // Runs of adjacent characters are a much stronger signal than scattered hits.
    if (index === previous + 1) score += 4;
    // So is landing on a word boundary.
    const before = index > 0 ? text[index - 1] : ' ';
    if (/[\s/\\_.-]/.test(before)) score += 3;
    if (text[index] === query[indices.length - 1]) score += 1;
    previous = index;
    position = index + 1;
  }

  return { score: score - text.length * 0.01, indices };
}

/** Filter and rank a list by a query, using `getText` to read each item. */
export function fuzzyFilter(items, query, getText, limit = 100) {
  if (!query) return items.slice(0, limit).map((item) => ({ item, indices: [] }));
  const scored = [];
  for (const item of items) {
    const match = fuzzyMatch(getText(item), query);
    if (match) scored.push({ item, score: match.score, indices: match.indices });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Split a string into matched / unmatched runs for highlighting. */
export function highlightParts(text, indices) {
  if (!indices || !indices.length) return [{ text, matched: false }];
  const set = new Set(indices);
  const parts = [];
  let current = '';
  let currentMatched = set.has(0);

  for (let i = 0; i < text.length; i += 1) {
    const matched = set.has(i);
    if (matched !== currentMatched) {
      if (current) parts.push({ text: current, matched: currentMatched });
      current = '';
      currentMatched = matched;
    }
    current += text[i];
  }
  if (current) parts.push({ text: current, matched: currentMatched });
  return parts;
}
