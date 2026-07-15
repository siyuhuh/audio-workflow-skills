# Design System — VocalFlow Studio

> Always read this file before making any visual or UI change in `apps/desktop`. It is the source of truth for color, typography, spacing, motion, and the Studio/Stage surface model. When changing a design rule, add a Decisions Log entry.

VocalFlow Studio uses a **sage industrial flat** token system for Studio capture/home, and a dedicated **Room instrument** language (ink canvas + accent-tinted panels, barcode tuner, digital mono readouts) inspired by precision clock/alarm UIs. Studio keeps terracotta-led sage by default; Room panel hue follows the Settings accent. **Corners use a radius hierarchy** — soft panels and circular actions where the instrument reference asks for them; sharp only on technical meters/hairlines.

## Product Context

- **What this is:** A desktop + CLI toolkit that turns YouTube/Bilibili links or local media into karaoke and subtitle packages: synced lyrics, optional stems, mic monitoring, and SRT/VTT/LRC/JSON/ASS exports.
- **Who it's for:** Singers, creators, video editors, and language learners.
- **Core flow:** Capture → Process → Review → Enter Room → Export.
- **UI promise:** Keep the current package, progress state, and next action obvious without visual clutter.

## Tailwind Entry

The renderer stylesheet must start with Tailwind v4:

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));
```

The app still uses existing CSS class names, but Tailwind theme variables are available through `@theme inline`. Dark mode must support both `.dark` and the existing Electron attributes: `.appShell[data-theme="dark"]` and `.appSceneFrame[data-theme="dark"]`.

## Aesthetic Direction

- **Direction:** industrial neo-minimal. Flat color blocks, thin hairline rules, barcode/vertical-line texture for meters and empty instrument fields.
- **Mood:** cool, precise, organized — not glassy, not skeuomorphic plastic.
- **Shape hierarchy (use radius to show level):**
  - `--radius-panel` / `--radius-2xl` (~28px): hero instrument blocks (selected track panel, Room chrome frame).
  - `--radius-lg` / `--radius-xl` (~16–24px): cards, capture deck, docks.
  - `--radius-md` (~12px): wells, list rows, quiet chips — **not** text action buttons.
  - `--radius-pill`: circular icon/play actions, nav capsule, footer dial rail.
  - `0`: text action buttons (`.uiKey` / primary CTAs), barcode/tuner lines, progress needles.
- **Depth:** Color-block hierarchy (ink void vs accent panel) + 1px `--rule` dividers. Tiled **noise.png** film grain overlay — not glass blur stacks.
- **Color behavior:** Four Studio palettes via Settings (`sage` / `slate` / `ink` / `clay`). Terracotta-led sage is default for Studio. **Room lobby + Stage** keep instrument layout; `--room-panel` follows accent (never force green onto blue).
- **Interaction:** Line hover uses south-growing fill (`--hover-fill`) and optional glyph scramble on Room setlist titles.
- **Default theme:** Light mode + **Sage** palette (Studio). Room surfaces are always dark instrument.

## Core Tokens


| Token | Light (sage) | Dark (olive) | Role |
| --- | --- | --- | --- |
| `--background` | `oklch(0.72 0.028 128)` | `oklch(0.28 0.02 135)` | App canvas |
| `--foreground` | `oklch(0.28 0.018 135)` | `oklch(0.92 0.012 128)` | Primary text |
| `--card` | `oklch(0.78 0.024 128)` | `oklch(0.34 0.02 135)` | Panels |
| `--primary` | `oklch(0.70 0.125 42)` | `oklch(0.72 0.125 42)` | Terracotta action |
| `--secondary` | `oklch(0.42 0.022 135)` | same family | Dark olive blocks |
| `--muted` | softer sage | darker olive | Secondary fills |
| `--rule` | charcoal @ ~35% | light @ ~20% | 1px dividers / card edges (not button outlines) |
| `--panel-dark` | olive charcoal | deeper olive | LCD / instrument wells |
| `--barcode` | repeating 1px vertical lines | same idea | Texture / meter field |
| `--room-panel` | accent-tinted | same | Room instrument fill / readout |

Renderer aliases (`--color-surface`, `--color-accent`, `--ktv-*`) must map back to these tokens.

## Typography

- **Sans / UI:** System-first stack. Prefer San Francisco / PingFang on Apple, Segoe UI / Microsoft YaHei UI on Windows, and Roboto / the native CJK fallback elsewhere.
- **Mono:** SF Mono / Cascadia Code / JetBrains Mono only for timecodes, progress values, logs, commands, and true technical readouts.
- **Weight:** Use 400 for body, 500–600 for controls and headings, and reserve 700 for rare emphasis.
- **Hierarchy:** Natural-case UI copy by default. Small tracked uppercase is reserved for short Latin metadata labels; never add tracking to Chinese labels or body copy.

## Layout And Surfaces

- Quiet sage canvas; cards use `--radius-lg` and 1px rules.
- Capture desk: soft-rounded card; scope uses barcode texture; LCD is a flat `--panel-dark` block; circular GO/STOP keys.
- Header: opaque surface, 1px bottom rule — no frosted blur.
- **Room lobby / Stage:** ink canvas + soft `--radius-panel` accent blocks; barcode tuner + red needle; circular play/icon actions; pill-shaped dock rail with dial ticks.

## Components

- **Primary button (Studio):** solid terracotta `--primary`, **square** (`border-radius: 0`), borderless; hover south-fill.
- **Primary button (Room):** solid `--room-panel`; **square** for text keys; circular only for icon play/confirm.
- **Secondary button:** borderless transparent text; hover south-fill (`--hover-fill`).
- **Cards:** `--card` + optional `--rule`, `--radius-lg`, no elevation shadow.
- **Inputs:** quiet rule + `--radius-md`; action keys stay borderless.

## Stage Lyrics

- Active lyric fill uses `--ktv-accent` / `--room-panel` for contrast on ink video; avoid neon cyan/pink.

## Accessibility

- Preserve `:focus-visible`.
- Keep 40px Studio targets / 32px Stage compact controls.
- Body text must stay readable on sage and olive panels.

## Refactor Budget

1. Keep Tailwind v4 entry + `@theme inline`.
2. Prefer flat industrial recipes over glass/skeuo leftovers.
3. Keep the system-first sans stack as the UI default; mono is a technical accent, not the product voice.
4. Do not reintroduce backdrop-blur glass or plastic gradients on Studio controls.
5. Do not force every corner to 0 — use the radius hierarchy.

Converted in the current experience pass:

- Add flow: replaced the multi-instrument capture console with a single composer, a visible recommended plan, and progressive disclosure for three common choices plus expert parameters.
- Recovery: desktop Auto mode tries platform captions first, then continues with local transcription without asking the user to restart the job.
- Karaoke Stage: replaced the stacked control wall with a lyrics-first canvas, centered transport, persistent Original / Backing switch, and origin-aware popovers for mixer, text style, queue, and room settings.
- Room tools: the four dock actions share one controlled popover surface; only one tool can be open, and settings use hairline sections instead of nested cards.
- History: completed packages live in Library / Room setlist surfaces, never in a persistent processing side rail. The capture workspace only shows its inline job progress.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-04-28 | Adopted Studio Paper + Warm Stage | Initial direction reduced neon karaoke tropes and clarified Studio vs Stage. |
| 2026-04-29 | Tried Linear Editorial Minimalism | Helped simplify the UI but felt too restrained for the desired product mood. |
| 2026-04-29 | Adopted supplied Tailwind v4 OKLCH style tokens | User preferred the provided pastel token set with Poppins, subtle shadows, soft surfaces, and more expressive color. |
| 2026-04-29 | Switched to dark-first green accent | User clarified the current accent felt pink and wanted the green from the dark dashboard reference, with a darker default background and Dark Mode by default. |
| 2026-04-30 | Added green-family accent variants | Settings now allows controlled green/teal accent switching while preserving the product's green-led brand direction. |
| 2026-05-03 | Standardized transparent thin scrollbars | Scrollbars should feel native and unobtrusive, with transparent tracks and theme-aware thumb contrast in both light and dark modes. |
| 2026-05-03 | Hid native macOS title bar for Studio chrome | The native white title bar clashed with the dark brand surface; the app should visually own the top chrome while preserving macOS traffic lights. |
| 2026-07-12 | Meevis-inspired Studio shell cleanup | Topology contour background felt noisy; Studio now uses a quiet split shell, centered pill nav, and denser card grid. |
| 2026-07-12 | Scroll region lives below fixed header | Page scroll and custom scrollbar belong to `.studioScrollRegion` under `--studio-chrome-height`. |
| 2026-07-13 | Room dock exposes backing + vocal volumes | Karaoke Room needs always-visible vertical faders next to transport. |
| 2026-07-13 | Header Room is setlist lobby, not Stage | Header must never skip the lobby and jump onto Stage. |
| 2026-07-13 | Accent cascade is primary-driven | Settings accent retints primary-driven roles together. |
| 2026-07-13 | First-launch intro splash | Cold start shows a short brand splash (localStorage-gated). |
| 2026-07-14 | Unified capture + media search input | Add desk: URL/path processes; plain text dual-searches YT+Bili, short clips first. |
| 2026-07-15 | Sage industrial flat (reference UI) | Dropped glass/skeuo clutter for sage canvas, olive panels, terracotta actions, 1px rules, barcode texture; default theme light sage. |
| 2026-07-15 | Four palettes + Codrops texture/hover | Settings exposes sage/slate/ink/clay full palettes; canvas uses Codrops `noise.png` film grain; Room setlist uses demo-4 south-fill hover + scramble. |
| 2026-07-15 | Braun hard-square corners              | All Studio/Stage radii forced to 0 (tokens + global override); no pills/soft rounds — Dieter Rams / Braun geometry. |
| 2026-07-15 | Codrops fonts + visible film texture   | UI uses JetBrains Mono / Nanum Gothic Coding; `noise.png` as fixed overlay (demo-4 style, no CRT scanlines); most keys are borderless with south-fill hover. |
| 2026-07-15 | Room = ink/sage instrument             | Room lobby + Stage follow alarm-instrument reference: ink canvas, barcode tuner + red needle; panel hue follows Settings accent (sage/slate/ink/clay). |
| 2026-07-15 | Radius hierarchy (not all-square)      | Soft panel / pill / circle radii restore instrument-reference hierarchy; sharp corners only on meters and tick marks. |
| 2026-07-15 | Default-first import + lyrics-first Stage | The main path now advances with one recommended plan; expert choices are progressively disclosed. Stage chrome keeps only track, transport, and four compact tool entry points visible so lyrics remain dominant. |
| 2026-07-15 | System-first typography | Replaced the all-mono UI voice with native system sans fallbacks for cleaner Latin/CJK rendering; mono remains limited to technical values and logs. |
| 2026-07-15 | Automatic caption fallback in desktop Auto mode | Missing platform captions are recoverable, so the normal path continues with local Whisper; strict Platform mode remains an explicit expert choice. |
| 2026-07-15 | One Room tool surface + no History rail | Mutually exclusive dock tools prevent stacked popovers; completed work belongs to the Library instead of competing with the active capture task. |
