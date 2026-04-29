# VocalFlow Studio Design Tokens

Defined in `apps/desktop/src/renderer/styles.css` `:root`.

## Color (semantic, paper theme)

| Token | Use |
| --- | --- |
| `--color-surface` | App background, paper canvas |
| `--color-surface-elevated` | Slightly raised surface (translucent white) |
| `--color-surface-strong` | Solid white surface (cards, inputs) |
| `--color-surface-muted` | Tinted surface for secondary blocks |
| `--color-surface-overlay` | High-translucent overlay surface |
| `--color-border` | Default border |
| `--color-border-strong` | Ink-on-paper outline (primary buttons, hero input) |
| `--color-border-soft` | Subtle divider |
| `--color-text` | Primary text |
| `--color-text-muted` | Secondary text |
| `--color-text-faint` | Tertiary / metadata text |
| `--color-accent` | Brand accent (links, focus, active) |
| `--color-accent-strong` | Stronger accent for filled states |
| `--color-accent-soft` | Tinted accent background (running pill, etc.) |
| `--color-success` / `--color-success-soft` | Complete states |
| `--color-warning` / `--color-warning-soft` | Caution states |
| `--color-danger` / `--color-danger-soft` | Failed / destructive |

`--ktv-*` variables stay separate for now; S-04 unifies both into theme-scoped overrides.

## Spacing (4px rhythm)

`--space-xs 4` `--space-sm 8` `--space-md 12` `--space-lg 16` `--space-xl 22` `--space-2xl 28` `--space-3xl 42`

## Radius

`--radius-sm 4` `--radius-md 6` `--radius-lg 8` `--radius-xl 10` `--radius-2xl 22` `--radius-pill 999px`

## Shadow / Elevation

| Token | Use |
| --- | --- |
| `--shadow-sm` | Subtle hairline elevation |
| `--shadow-md` | Card-on-paper elevation |
| `--shadow-lg` | Hero composer / room panel |
| `--shadow-overlay` | Drawer / modal overlay |

## Typography

`--font-size-xs 11` `--font-size-sm 12` `--font-size-md 13` `--font-size-lg 15` `--font-size-xl 18` `--font-size-2xl 24`
`--font-size-display` clamp(64px, 9vw, 128px)

`--line-height-tight 1.05` `--line-height-snug 1.25` `--line-height-normal 1.4` `--line-height-relaxed 1.5`

`--font-family-sans` Inter + system + CJK fallbacks (PingFang, Hiragino, YaHei, Noto CJK)
`--font-family-display` Georgia + Songti SC
`--font-family-mono` SFMono-Regular + Consolas

## Motion

`--motion-duration-fast 140ms` `--motion-duration-base 220ms` `--motion-duration-slow 360ms`

`--motion-ease-out` smooth deceleration (default)
`--motion-ease-in-out` symmetric for layout shifts
`--motion-ease-spring` overshoot spring (Springen-style)

Legacy aliases `--ease-out` / `--ease-in-out` / `--springen-ease` still resolve to these so untouched surfaces keep working.

## Scope

Sprint 1 applies these only to L1 Library surfaces (start hero, hero composer, resource shelf/grid/card, room panel, status pill, primary/secondary buttons, eyebrow). Lyrics review, Karaoke Room, advanced workspace surfaces are migrated incrementally in S-02..S-06.
