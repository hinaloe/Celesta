// Colors as the components take them: a hex color or a `<Theme>` color name.

import type { ResolvedTheme } from '@celesta/react';

const HEX_COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** `color` resolved through the theme's colors and checked to be `#RRGGBB` or `#RRGGBBAA`. */
export function hexColor(color: string, theme: ResolvedTheme, component: string, prop: string): string {
  const resolved = Object.prototype.hasOwnProperty.call(theme.colors, color) ? theme.colors[color]! : color;
  if (!HEX_COLOR.test(resolved)) {
    throw new Error(`<${component}> ${prop} ${JSON.stringify(color)} is neither a #RRGGBB or #RRGGBBAA color nor a <Theme> color name`);
  }
  return resolved;
}

/** The alpha of a hex color, 0–1. */
export function alphaOf(color: string): number {
  return color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1;
}

/** `color` with its alpha multiplied by `opacity`. */
export function fade(color: string, opacity: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, alphaOf(color) * opacity)) * 255);
  return color.slice(0, 7) + byte.toString(16).padStart(2, '0');
}
