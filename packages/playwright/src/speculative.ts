/**
 * A request the page sent on speculation: `Sec-Purpose` is the standard's name,
 * sent by `<link rel="prefetch">` and speculation rules; `Purpose` is the name
 * before it; `Next-Router-Prefetch` is the Next.js App Router's, which a router
 * reproducing it sends for every link it can see.
 */
export function isSpeculative(headers: Readonly<Record<string, string>>): boolean {
  const purpose = headers['sec-purpose'] ?? headers['purpose'] ?? '';
  return /(^|[\s,;])prefetch\b/.test(purpose) || headers['next-router-prefetch'] === '1';
}
