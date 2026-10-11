/**
 * `hex` (`#RRGGBB` or `#RRGGBBAA`) with its alpha multiplied by `alpha`
 * (0–1), as `#RRGGBBAA`. The `accent` property may carry its own alpha, so
 * tints are made with this rather than by appending two digits.
 */
export function withAlpha(hex: string, alpha: number): string {
  const own = hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;
  const value = Math.round(Math.min(1, Math.max(0, own * alpha)) * 255);
  return `${hex.slice(0, 7)}${value.toString(16).padStart(2, '0').toUpperCase()}`;
}
