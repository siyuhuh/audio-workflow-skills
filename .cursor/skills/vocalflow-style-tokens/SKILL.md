---
name: vocalflow-style-tokens
description: Applies VocalFlow Studio's sage industrial flat design system. Use when editing DESIGN.md, renderer CSS, desktop UI components, Stage/Karaoke visuals, or any interface work that should follow the sage canvas, charcoal-olive panels, terracotta accent, radius hierarchy, and no-glass controls.
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

- Room lobby + Stage: ink canvas + instrument layout; `--room-panel` hue follows Settings accent.
- Radius hierarchy: soft panels (`--radius-panel`), cards (`--radius-lg`), keys (`--radius-md`), circular actions (`--radius-pill`); sharp only on barcode/needles.
- JetBrains Mono (+ Nanum Gothic Coding) for UI — Codrops Line TextHover demo 4.
- Fixed film grain (`noise.png`) over the shell so texture always reads.
- Most keys are borderless; hover uses south-fill wash (`--hover-fill`), not outline borders.

## Component Defaults

- Primary button (Studio): solid terracotta `--primary`, **square corners**, borderless, south-fill hover.
- Primary button (Room): solid `--room-panel`; square for text CTAs; circular only for icon play/confirm.
- Secondary / ghost: transparent text, borderless, south-fill hover (`--hover-fill`).
- Card: `--card`, optional 1px `--rule`, `--radius-lg`, no elevation shadow.
- Input: quiet rule + `--radius-md`; action keys stay borderless.

## Reject

- Forcing every corner to 0 (Braun hard-square everywhere).
- Glassmorphism / backdrop-blur control shells.
- Skeuomorphic plastic button stacks.
- Neon green / purple / pink as the main accent.
- Decorative gradient meshes on the Studio canvas.
- Forcing sage green into Room when accent is slate/clay.
