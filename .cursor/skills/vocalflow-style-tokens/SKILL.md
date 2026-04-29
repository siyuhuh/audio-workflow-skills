---
name: vocalflow-style-tokens
description: Applies VocalFlow Studio's dark-first Tailwind v4 OKLCH style-token design system. Use when editing DESIGN.md, renderer CSS, desktop UI components, Stage/Karaoke visuals, or any interface work that should follow the green-accent dark dashboard palette, Poppins typography, compact radius, and subtle shadows.
---

# VocalFlow Style Tokens

Use this skill for visual or UI changes in `apps/desktop`, especially `DESIGN.md`, `apps/desktop/src/renderer/styles.css`, `apps/desktop/src/renderer/App.tsx`, and Stage/Karaoke Room styling.

## Required First Step

Read `DESIGN.md` before changing UI code. It is the source of truth.

## Tailwind Entry

Renderer CSS must use Tailwind v4:

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));
```

Expose theme variables through `@theme inline`. Keep compatibility with the existing Electron theme attributes:

- `.appShell[data-theme="dark"]`
- `.appSceneFrame[data-theme="dark"]`

## Visual Direction

- Use the supplied OKLCH token palette, not Linear purple.
- The product default is Dark Mode with a vivid green primary/accent. Avoid pink or purple as the main action color.
- Use Poppins for UI and Roboto Mono for timecodes, logs, and command previews.
- Use `0.5rem` radius as the default; use pill radius only for docks, chips, and transport groups.
- Reintroduce small tactile shadows from the token set. Avoid large blurred shadows.
- Keep Stage expressive but readable: darker token surfaces, green lyric progress, compact controls.

## Component Defaults

- Primary button: `--primary` fill, `--primary-foreground`, small shadow.
- Secondary button: `--card` or `--secondary`, 1px `--border`, compact radius.
- Card: `--card`, 1px `--border`, `--radius-lg`, `--shadow-sm-token`.
- Input: `--card`, 1px `--input`, focus ring from `--ring`.
- Status chip: use semantic colors only for actual status.

## Reject

- Single-purple Linear look.
- Pink primary action states.
- Pure cyan karaoke glow from the old UI.
- Warm coral paper-stage palette from the earlier design.
- Huge marketing hero shadows.
- New color literals when an existing token can express the same role.
