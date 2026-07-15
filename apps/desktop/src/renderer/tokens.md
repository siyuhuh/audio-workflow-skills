# VocalFlow Studio Design Tokens

Defined in `apps/desktop/src/renderer/styles.css`. The source of truth is `DESIGN.md`.

## Tailwind

The renderer stylesheet uses Tailwind v4:

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
```

`@theme inline` exposes the same variables as Tailwind theme colors, fonts, radii, and shadows.

## Core Color Tokens

| Token | Light value | Dark value |
| --- | --- | --- |
| `--background` | `oklch(0.9809 0.0025 228.7836)` | `oklch(0.1450 0.0120 264.2926)` |
| `--foreground` | `oklch(0.3211 0 0)` | `oklch(0.9219 0 0)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.2050 0.0100 264.2926)` |
| `--primary` | `oklch(0.7395 0.2268 142.8504)` | `oklch(0.7395 0.2268 142.8504)` |
| `--secondary` | `oklch(0.8148 0.0819 225.7537)` | `oklch(0.2700 0.0120 264.2926)` |
| `--muted` | `oklch(0.8828 0.0285 98.1033)` | `oklch(0.2600 0.0080 264.2926)` |
| `--accent` | `oklch(0.7395 0.2268 142.8504)` | `oklch(0.7395 0.2268 142.8504)` |
| `--border` | `oklch(0.8699 0 0)` | `oklch(0.3100 0.0060 264.2926)` |
| `--ring` | green primary | green primary |

Existing renderer aliases map to these tokens:

- `--color-surface` → `--background`
- `--color-surface-strong` → `--card`
- `--color-text` → `--foreground`
- `--color-accent` → green `--primary`
- `--ktv-*` → darker Stage token palette with green lyric progress

## Typography

- `--font-family-sans`: JetBrains Mono + Nanum Gothic Coding (+ CJK fallbacks).
- `--font-family-display`: same as sans.
- `--font-family-mono`: same mono stack as Codrops Line TextHover demo 4.

## Radius And Shadow

- Base radius: `--radius: 0.5rem`.
- Renderer radius aliases keep legacy selectors working: `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-2xl`, `--radius-pill`.
- Use supplied small shadows: `--shadow-sm-token`, `--shadow-md-token`, `--shadow-lg-token`, and `--shadow-overlay`.

## Motion

Functional motion only. Use explicit transitions, never `transition: all`.
