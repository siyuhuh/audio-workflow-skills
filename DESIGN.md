# Design System — VocalFlow Studio

> Always read this file before making any visual or UI change in `apps/desktop`. It is the source of truth for color, typography, spacing, motion, and the Studio/Stage surface model. When changing a design rule, add a Decisions Log entry.

VocalFlow Studio now uses a **dark-first Tailwind v4 OKLCH style-token system**: near-black surfaces, Poppins typography, a single vivid green accent, compact radius, and small tactile shadows. The goal is friendly creator software that feels focused and slightly technical, closer to the supplied dark dashboard reference.

## Product Context

- **What this is:** A desktop + CLI toolkit that turns YouTube/Bilibili links or local media into karaoke and subtitle packages: synced lyrics, optional stems, mic monitoring, and SRT/VTT/LRC/JSON/ASS exports.
- **Who it's for:** Singers, creators, video editors, and language learners.
- **Core flow:** Capture → Process → Review → Enter Room → Export.
- **UI promise:** Keep the current package, progress state, and next action obvious without making the interface feel clinical.

## Tailwind Entry

The renderer stylesheet must start with Tailwind v4:

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));
```

The app still uses existing CSS class names, but Tailwind theme variables are available through `@theme inline`. Dark mode must support both `.dark` and the existing Electron attributes: `.appShell[data-theme="dark"]` and `.appSceneFrame[data-theme="dark"]`.

## Aesthetic Direction

- **Direction:** dark dashboard utility. Near-black canvas, dark cards, green active state, and subtle physical shadows.
- **Mood:** focused, modern, creative, lightly musical.
- **Shape:** `0.5rem` radius as the default. Larger radii are allowed only for floating docks and pills.
- **Depth:** Use the supplied small shadow tokens. Avoid the previous flat Linear look and avoid huge blurred hero shadows.
- **Color behavior:** Green is the primary action, active state, and high-energy highlight. Avoid pink/purple as the main accent.
- **Accent variants:** Users may switch between approved green-family accents in Settings. Variants must stay within the green/teal range and continue mapping through `--primary`, `--accent`, `--ring`, and `--ktv-accent`.
- **Default theme:** Dark Mode is the product default. Light mode remains available as an explicit setting.

## Core Tokens

Use these exact token families in `styles.css`.


| Token                  | Light value                     | Dark value                      | Role                          |
| ---------------------- | ------------------------------- | ------------------------------- | ----------------------------- |
| `--background`         | `oklch(0.9809 0.0025 228.7836)` | `oklch(0.1450 0.0120 264.2926)` | App canvas                    |
| `--foreground`         | `oklch(0.3211 0 0)`             | `oklch(0.9219 0 0)`             | Primary text                  |
| `--card`               | `oklch(1 0 0)`                  | `oklch(0.2050 0.0100 264.2926)` | Cards and panels              |
| `--primary`            | `oklch(0.7395 0.2268 142.8504)` | `oklch(0.7395 0.2268 142.8504)` | Primary action / green accent |
| `--secondary`          | `oklch(0.8148 0.0819 225.7537)` | `oklch(0.2700 0.0120 264.2926)` | Secondary surfaces            |
| `--muted`              | `oklch(0.8828 0.0285 98.1033)`  | `oklch(0.2600 0.0080 264.2926)` | Muted blocks                  |
| `--accent`             | `oklch(0.7395 0.2268 142.8504)` | `oklch(0.7395 0.2268 142.8504)` | High-energy green highlight   |
| `--destructive`        | `oklch(0.6368 0.2078 25.3313)`  | same                            | Destructive state             |
| `--border` / `--input` | `oklch(0.8699 0 0)`             | `oklch(0.3100 0.0060 264.2926)` | Borders and inputs            |
| `--ring`               | primary                         | dark primary                    | Focus ring                    |


Renderer aliases such as `--color-surface`, `--color-text`, `--color-accent`, and `--ktv-`* must map back to these tokens. Do not create independent palettes unless a new token is added here first.

## Typography

- **Sans:** Poppins, then system sans and CJK fallbacks.
- **Mono:** Roboto Mono, then platform monospace fallbacks.
- **Serif:** Available as a token, but not used for core chrome.
- **Weights:** 400/500/600 for UI, 700 allowed for Stage lyrics only.
- **Tone:** Rounded, friendly, readable. Avoid the previous editorial/Swiss feeling.

## Layout And Surfaces

- **Studio:** dark by default with near-black canvas, dark cards, and green action states. Light mode keeps soft surfaces for explicit preference only.
- **Stage:** darker token surface with green lyric progress. It can feel more expressive than Studio, but controls must stay readable.
- **Max width:** 1200px for Studio body; 1280px for Stage lyric line.
- **Spacing:** 4px rhythm via `--spacing: 0.25rem`.
- **Density:** Keep workflow controls compact, but allow more breathing room than the Linear pass.

## Components

- **Primary button:** `--primary` fill, `--primary-foreground`, radius `--radius-md`, small shadow.
- **Secondary button:** `--card`/`--secondary` depending on emphasis, 1px border, small shadow only when it helps affordance.
- **Cards:** `--card`, 1px `--border`, radius `--radius-lg`, `--shadow-sm`.
- **Inputs:** `--card` or dark `--card`, 1px `--input`, focus ring from `--ring`.
- **Status chips:** Use status colors only for state. Do not decorate random labels as success/warn/error.
- **Stage dock:** Dark card token, small border, pill radius, no oversized glass blur.

## Stage Lyrics

- Active lyric fill should use the green primary/accent, not pink, cyan, or Linear purple.
- Keep text stroke/shadow enough for video preview contrast.
- Supported effects remain `outline`, `sweep`, `neon`, and `impact`; each must stay inside the token palette.
- The dock, side drawer, and queue must never cover the active lyric line.

## Accessibility

- Preserve visible `:focus-visible` everywhere.
- Keep 40px minimum targets in Studio and 32px compact controls in Stage.
- Long song titles, paths, and filenames must truncate or wrap safely.
- Body text contrast must remain readable on `--background`, `--card`, and dark Stage surfaces.

## Refactor Budget

1. Keep Tailwind v4 active through `@import "tailwindcss"` and `@theme inline`.
2. Replace pink/purple main accents with the green primary/accent token system.
3. Keep Poppins/Roboto Mono mapped into renderer font aliases.
4. Reintroduce small tactile shadows from the supplied shadow tokens, not large blurred cards.
5. Convert Stage lyric and remote-room colors to the new dark token palette.
6. Remove stale references to Linear editorial minimalism from skills, docs, and UI copy.

## Decisions Log


| Date       | Decision                                        | Rationale                                                                                                                                                      |
| ---------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-28 | Adopted Studio Paper + Warm Stage               | Initial direction reduced neon karaoke tropes and clarified Studio vs Stage.                                                                                   |
| 2026-04-29 | Tried Linear Editorial Minimalism               | Helped simplify the UI but felt too restrained for the desired product mood.                                                                                   |
| 2026-04-29 | Adopted supplied Tailwind v4 OKLCH style tokens | User preferred the provided pastel token set with Poppins, subtle shadows, soft surfaces, and more expressive color.                                           |
| 2026-04-29 | Switched to dark-first green accent             | User clarified the current accent felt pink and wanted the green from the dark dashboard reference, with a darker default background and Dark Mode by default. |
| 2026-04-30 | Added green-family accent variants              | Settings now allows controlled green/teal accent switching while preserving the product's green-led brand direction.                                           |


