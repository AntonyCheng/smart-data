const CJK = /[㐀-䶿一-鿿豈-﫿]/g;

/** Conservative token estimate used before the model reports real usage. */
export function estimateChineseTokens(value: string): number {
  const cjkCount = value.match(CJK)?.length ?? 0;
  const remaining = value.length - cjkCount;
  return Math.max(1, Math.ceil(cjkCount * 1.15 + remaining / 4));
}
