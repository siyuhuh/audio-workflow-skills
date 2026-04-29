# Design System — VocalFlow Studio

> Always read this file before making any visual or UI change in `apps/desktop`. All color, typography, spacing, motion, and layout decisions are defined here. Do not deviate without explicit user approval, and add a Decisions Log entry when you do.

This is the design source of truth for the desktop app and any future web shell at `127.0.0.1:5174`. It complements `AGENT.md` (development behavior) and `.cursor/rules/agent-behavior.mdc` (agent guardrails).

## Product Context

- **What this is:** VocalFlow Studio is a desktop + CLI toolkit that turns a YouTube/Bilibili link or a local audio/video file into a singing-practice and karaoke package — synced lyrics, optional vocal/instrumental stems, microphone monitoring, and exports for SRT/VTT/LRC/JSON.
- **Who it's for:** Singers, video editors, language learners, and content creators who want timestamped lyrics or subtitles without juggling Whisper, yt-dlp, ffmpeg, and UVR by hand.
- **Space/peers:** UVR (Ultimate Vocal Remover), CapCut/DaVinci subtitle workflows, RipX, KaraFun, OBS for vocal monitoring. None combine "paste link → karaoke-ready package with mic monitor."
- **Project type:** Electron desktop app (macOS + Windows) wrapping a Python CLI. Two visually distinct surfaces:
  - **Studio** — paper-toned workspace for input, queue, lyric review, package detail, settings.
  - **Stage** — dark karaoke room for playback, lyric performance, mic monitor.
- **Core positioning:** "Bring the song into the room." The CLI does the hard processing; the UI's job is to make a single song package feel inevitable from the moment the URL is pasted to the moment the room is sung in.

## Aesthetic Direction

- **Direction:** **Studio Paper + Warm Stage.** The workspace feels like a recording engineer's notebook on warm paper. The Karaoke Room feels like a dim warm stage with one spotlight, not a neon arcade.
- **Decoration level:** Minimal. Typography, hierarchy, and one accent carry everything. No gradients, no decorative blobs, no glass-on-glass stacking.
- **Mood:** Calm, attentive, slightly analog. The product handles voice and lyrics — the chrome should not compete with the words on screen.
- **Differentiation:** Most karaoke and subtitle tools default to neon cyan / electric blue / black. VocalFlow leans warm and quiet so the lyrics, the waveform, and the singer's voice are the loud thing.

## Surface Model

The app has **two surfaces** that share one design spine. Decide which surface a screen belongs to before styling it.

| Surface | Used for | Background | Text on bg | Surface tone |
|---------|----------|------------|------------|--------------|
| **Studio** | Hero / input, queue, package list, lyric review, settings, history, advanced drawers | `--paper` | `--ink` | warm white cards |
| **Stage** | Karaoke Room, fullscreen lyric playback, mic monitor, transport dock | `--stage-bg` | `--stage-text` | translucent dark glass |

Rules:

- A single screen is **one** surface — never mix paper cards inside the Stage or dark glass inside the Studio.
- Cross-surface transitions (Studio → Stage when entering the Karaoke Room) use a 220ms fade + scale(0.99→1) on the new surface, not a slide.
- Both surfaces share the same type ramp, accent color, radius scale, and motion language.

## Layout Philosophy

- **Core principle:** The active content (lyric, cue, waveform) owns the center of the screen. Chrome orbits it.
- **Studio home:** Single-column reading width. Hero composer at the top, resource shelf below, history at the bottom. No sidebar at the home state.
- **Studio workspace (after a job runs):** Two-pane: queue/history on the left (260–290px), detail/review on the right (1fr). Drawers, not modals, for advanced controls.
- **Stage (Karaoke Room):** Fullscreen. Lyrics anchored bottom-third. Bottom-center transport dock. Top-left compact metadata. Bottom-right collapsed settings drawer. **Default chrome must never cover the active lyric line.**
- **Max content width:** 1280px for the Studio body, lyric line capped at 1280px on Stage.
- **Alignment:** Left-aligned text in the Studio. Centered only on the Stage (lyrics) and on empty/onboarding states.

### Radius Scale

Use only these. No invented values.

| Token | Value | Used for |
|-------|-------|----------|
| `--r-xs` | 4px | Badges, chips, tag pills, status dots |
| `--r-sm` | 6px | Inputs, secondary buttons, segmented controls |
| `--r-md` | 8px | Cards, input bands, queue items |
| `--r-lg` | 12px | Package cards, panels, drawers |
| `--r-xl` | 22px | Floating glass panels on Stage (transport dock, side drawers) |
| `--r-pill` | 999px | Pill toggles, hoverFill groups, status pills, primary CTAs in Stage |

## Typography

- **UI / Body:** Geist Sans (preferred) — load via Google Fonts. Inter remains the fallback in `font-family` so existing screens keep rendering until Geist is wired in. Do **not** use system-ui or Roboto as primary.
- **Display (hero, package title):** Geist Sans 600 at the cap sizes below. The current Georgia 900 hero is being retired — see Anti-patterns.
- **Numerics (timecodes, durations, counts, frame indices):** Geist Mono 500 with `font-variant-numeric: tabular-nums`. Mandatory for the transport dock, cue list timestamps, and any duration label.
- **Loading:**

  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
  ```

### Type Scale

Pin a screen to this scale. Replace `clamp(...)` literals with one of the tokens below.

| Role | Size | Weight | Family |
|------|------|--------|--------|
| Display (Studio hero `h1`) | 44px | 600 | Geist Sans |
| Page title (`h1`) | 28px | 600 | Geist Sans |
| Section title (`h2`) | 18px | 600 | Geist Sans |
| Card title | 15px | 600 | Geist Sans |
| Body | 14px | 400 | Geist Sans |
| Body strong / button label | 14px | 500 | Geist Sans |
| Eyebrow / labels (caps) | 11px | 500 (letter-spacing 0.06em, uppercase) | Geist Sans |
| Meta / secondary | 12px | 400/500 | Geist Sans |
| Timecodes / counts | 12px | 500 | Geist Mono (tabular-nums) |
| Karaoke lyric line (Stage) | clamp(40px, 6vw, 76px) | 600 | Geist Sans |
| Karaoke context line | clamp(18px, 2vw, 26px) | 500 | Geist Sans |

**Allowed weights:** 400, 500, 600, 700. The display lyric is the only place 600 is the maximum. Existing 800/850/900/950 declarations are anti-pattern — see "Refactor budget."

## Color

One accent. Warm neutrals. Color is rare and meaningful.

### Studio (light surface)

| Token | Hex | Usage |
|-------|-----|-------|
| `--paper` | `#F7F4EC` | App background — warm off-white, never `#FFFFFF` |
| `--paper-raised` | `#FFFFFF` | Cards, input bands, drawers |
| `--paper-sunken` | `#EFEBDD` | Hovered surfaces, secondary chips |
| `--ink` | `#1F1E1A` | Primary text |
| `--ink-muted` | `#65645A` | Secondary text, eyebrow, meta |
| `--ink-faint` | `#A6A496` | Placeholder, disabled |
| `--rule` | `#E2DCC9` | Hairlines, dividers, card borders |
| `--rule-strong` | `#CBC4AE` | Input borders, focus-adjacent |
| `--accent` | `#C85A2A` | Primary signal — warm coral, evokes voice and breath |
| `--accent-bg` | `#FFF1E6` | Tinted backgrounds (selected cue, active option, AI suggestion) |
| `--accent-ink` | `#5A2410` | Text on accent-tinted backgrounds |

### Stage (dark surface)

| Token | Hex | Usage |
|-------|-----|-------|
| `--stage-bg` | `#0E0D0A` | Karaoke room background — warm near-black, never `#000` |
| `--stage-glass` | `rgba(255, 247, 232, 0.06)` | Floating panels (transport dock, side drawer) |
| `--stage-glass-strong` | `rgba(20, 18, 14, 0.78)` | Open drawer contents, popovers |
| `--stage-line` | `rgba(255, 247, 232, 0.14)` | Hairlines on glass |
| `--stage-text` | `#F5F1E4` | Primary text |
| `--stage-text-muted` | `rgba(245, 241, 228, 0.66)` | Secondary text, meta |
| `--stage-accent` | `#F2864A` | Lifted accent for dark — same hue family as `--accent`, brighter L |
| `--stage-accent-bg` | `rgba(242, 134, 74, 0.18)` | Active hoverFill, selected cue glow |

### Lyric Effect Palette (Stage only)

The four `data-effect` modes share the warm spine. Cyan/electric variants are deprecated — see Anti-patterns.

| Effect | `--lyric-base` | `--lyric-fill` | `--lyric-stroke` | `--lyric-glow` |
|--------|----------------|----------------|------------------|----------------|
| `outline` (default) | `rgba(245, 241, 228, 0.72)` | `#F5F1E4` | `rgba(14, 13, 10, 0.7)` | `rgba(245, 241, 228, 0.16)` |
| `sweep` | `rgba(245, 241, 228, 0.78)` | `#F2864A` | `rgba(14, 13, 10, 0.6)` | `rgba(242, 134, 74, 0.36)` |
| `neon` | `rgba(255, 230, 200, 0.78)` | `#FFB36B` | `rgba(40, 18, 4, 0.7)` | `rgba(255, 179, 107, 0.55)` |
| `impact` | `rgba(255, 244, 232, 0.8)` | `#E84D4D` | `rgba(255, 248, 240, 0.85)` | `rgba(232, 77, 77, 0.42)` |

### Status Colors

Used only on status pills, queue item borders, and stem readiness chips.

| State | Light dot/border | Light bg | Stage dot |
|-------|------------------|----------|-----------|
| `running` | `#4A7DB0` | `#EAF1FA` | `#7AB0E6` |
| `complete` / `ready` | `#4F8A4F` | `#ECF4EC` | `#7DCB7D` |
| `failed` / `canceled` | `#B2553F` | `#FBEAE3` | `#E58A75` |
| `warn` / `stale` | `#C9981E` | `#FBF1D5` | `#F2C94C` |

**Focus ring:** `--focus-ring: rgba(200, 90, 42, 0.55)` (Studio) and `rgba(242, 134, 74, 0.6)` (Stage). Never `outline: none` without a replacement.

## Spacing

- **Base unit:** 4px
- **Density:** Comfortable in the Studio, compact on the Stage glass panels.
- **Scale:** 2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 64
- **Card padding:** 16px (Studio cards), 12px (Studio compact rows), 10px (Stage glass panels)
- **Section gap:** 24px between Studio sections, 16px inside a card, 8px inside a control group
- **Hero composer padding:** 18px
- **Stage transport dock padding:** 9px 12px

## Motion

- **Approach:** Functional motion only. No decorative scroll animations, no parallax, no idle pulses outside of the audio visualizer.
- **Durations:**
  - Hover background / border: 80ms
  - Toggle, segmented control, hoverFill surface translate: 180ms
  - Surface transitions (Studio ↔ Stage, scene swap): 220ms
  - Lyric word fill (`--word-progress`): 70ms linear (timing-driven by audio, not eased)
- **Easing tokens:**
  - `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` — default
  - `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` — surface/scene transitions
  - `--ease-spring: cubic-bezier(0.34, 1.25, 0.52, 1)` — hoverFill only (capped at 220ms to avoid bounce wobble)
- **Allowed properties:** `transform`, `opacity`, `clip-path`, explicit `width`/`height` on hoverFill surfaces only, `background-color`, `border-color`, `color`. Never `transition: all`.
- **`prefers-reduced-motion`:** Drop animation duration to ≤1ms, disable hoverFill translate, keep lyric word fill (it's a content indicator, not decoration).

## UI States

### Composer (Studio hero input)

- **Idle:** Card on `--paper-raised`, 1px `--rule` border, `--r-md` radius, soft shadow `0 12px 32px rgba(31, 30, 26, 0.06)`. Input height 48px (was 56px — see Refactor budget).
- **Focused input:** Border `--accent`, focus ring `--focus-ring`.
- **Submit pending:** Primary button shows inline spinner (12px). Card border stays at rest — no border color change while running.

### Primary / Secondary buttons (Studio)

- **Primary:** Solid `--ink` background, `--paper-raised` text, `--r-sm` radius, 40px min-height. Hover lifts to `#2A2924`. Active scale(0.97).
- **Secondary:** `--paper-raised` background, 1px `--rule-strong` border, `--ink` text. Hover background `--paper-sunken`.
- Both use the **same** weight (500) and size (14px). No 800+ weight on action buttons.

### Segmented Control / hoverFill Group

- One shared HoverFill surface per group. Never per-sibling hover backgrounds.
- Pill container, `--r-pill` radius, 1px `--rule` border, `--paper-sunken` background (Studio) or `--stage-glass` (Stage).
- Selected state uses `--accent-bg` background + `--accent-ink` text in Studio, and `--stage-accent-bg` + `--stage-text` on Stage.
- Item min-height 32px (Stage), 36px (Studio).

### Result / Cue list rows

- **Default:** No background, 10px 12px padding, `--rule` bottom border.
- **Hovered:** `--paper-sunken` background.
- **Active (currently playing cue):** `--accent-bg` background + 3px left border `--accent`.
- Cue clicks **must** route through `usePlaybackController().seek()`. Never bypass.

### Status Pill

- Pill shape, `--r-pill`, 8px 14px padding, 13px / weight 500.
- Color set by `data-state` mapping above. Always include both border and background for legibility on `--paper`.

### Transport Dock (Stage)

- Floating glass card centered at the bottom, `--r-xl` radius, `--stage-glass` background, `backdrop-filter: blur(22px) saturate(1.15)`.
- Width: `min(560px, 46vw)`, min-width 360px on desktop; full-width minus 24px on `≤720px`.
- Dock contents: scrubber (top row), 3-button transport (Prev / Play / Next) and tabular-nums time (bottom row). Track-role switch (Original / Backing / Vocal) lives **inside** the dock as a hoverFill group, never as a separate panel.

### Side Drawer (Stage)

- Bottom-right collapsed pill (`--r-pill`). On open: expands to `--r-xl` glass panel anchored above the pill.
- Holds: package selector, hidden-vocal toggle, font/effect popovers, mic monitor, room cue list (capped 190px).
- Drawer must never overlap the active lyric line — if viewport is too short, push lyrics up via the `@media (max-height: 740px)` rule.

### Karaoke Header (Stage)

- Top gradient bar from `rgba(0,0,0,0.55)` to transparent, 12px 20px padding.
- Holds title (truncated, max 520px), eyebrow meta, "Exit room" pill secondary button.
- Header text uses `--stage-text-muted` for everything except the title.

## Icons

- **Library:** Lucide React (`lucide-react`). 1.5px stroke at 16px and 14px sizes. Never bold/filled for chrome.
- **Replace all emoji** in production UI (current `🎤`, `🎬`, `▶`, etc.) with Lucide equivalents:
  - Play / pause / restart → `Play`, `Pause`, `RotateCcw`
  - Mic monitor → `Mic`, `MicOff`
  - Track role → `Music2`, `Disc3`, `User`
  - Add / capture → `PlusCircle`
  - Settings / drawer → `Settings2`, `SlidersHorizontal`
  - Status dots → no icon, pure colored circle via CSS
- Emoji are allowed only in chat-style logs and copy that quotes user/CLI output.

## Lyric Stage Rules

These are non-negotiable because the lyrics are the product on the Stage.

- The active lyric line is the largest text on the screen and the brightest element on the Stage palette.
- Word-level fill (`--word-progress`) is a 70ms linear animation driven by audio time. Do not ease it.
- Active word lift: `translateY(-0.025em) scale(1.035)` — keep this exact value to avoid layout jitter.
- Stroke is `--lyric-stroke`; never remove the stroke without replacing it with a solid card background, otherwise lyrics become unreadable on bright preview video.
- Lyric font picker (`data-font`) values are: `rounded` (default), `serif`, `poster`, `mono`. Each maps to one font stack documented in `styles.css`. Do not add new font modes without a Decisions Log entry.
- Lyric effect picker (`data-effect`) values are constrained to the four entries in the Lyric Effect Palette table. The legacy cyan-based variants (`--ktv-accent: #57f1ff`) are deprecated.

## Accessibility

- All interactive elements need visible `:focus-visible` (2px solid, 2px offset, color from focus ring tokens above).
- Minimum touch target 32px × 32px (Stage compact controls), 40px × 40px (Studio).
- Color contrast: text on `--paper` ≥ 7:1 for body, ≥ 4.5:1 for `--ink-muted`. Text on `--stage-bg` ≥ 7:1 for body. Verify any new color choice with a contrast checker before committing.
- Long text (song titles, filenames, paths) uses `min-width: 0` + `text-overflow: ellipsis` or wrapping. Never let long input overflow a layout.
- Mic monitor toggles, package selector, and transport buttons must remain operable via keyboard alone. Tab order: header → composer → cue list → transport.

## First-Person Voice

The Studio talks to one user about their work. Use first-person ("your", "you") in metadata, not third-person system labels.

| Do | Don't |
|----|-------|
| "You generated this from YouTube · 2h ago" | "Job · 2h ago" |
| "Your last room session" | "Karaoke history" |
| "We'll keep this in your library" | "Saved to history" |
| "Lyrics from platform captions" | "Source: yt-dlp captions" |

## Anti-patterns — Never Do

- **`transition: all`** anywhere. Always enumerate properties.
- **Pure black `#000` / cold gray `#0A0A0A`** — Stage uses warm near-black `#0E0D0A`.
- **Pure white `#FFFFFF` as page background** — Studio uses warm off-white `#F7F4EC`. Cards may be `#FFFFFF`.
- **Font-weight 800 / 850 / 900 / 950** in body or button labels. Cap at 700.
- **Georgia / Times serif as the primary display font.** The current `clamp(64px, 9vw, 128px)` Georgia hero is the single biggest source of "uncomfortable" feedback — replace with Geist 600 at the documented Display size.
- **Cyan / electric blue accent (`#57f1ff`, `#1479ff`).** Replace with `--accent` / `--stage-accent`. The product is about voice, not consumer electronics.
- **Per-sibling hover backgrounds in dense control groups.** Use one shared HoverFill surface per group.
- **Glass-on-glass stacking.** Floating panels on the Stage may not contain other floating panels; use solid `--stage-glass-strong` for nested popovers.
- **Modals over the Karaoke Room.** Use the bottom side drawer instead.
- **`outline: none`** without a replacement focus state.
- **Ad-hoc clamp() font sizes** — pick from the type scale.
- **Emoji as production UI icons** — Lucide React only.

## Refactor Budget (current → target)

This is the to-do list for converging the existing CSS in `apps/desktop/src/renderer/styles.css` onto this spec. Treat each line as a small, surgical PR-sized change.

1. Replace the Georgia hero `h1` with `font: 600 44px / 1.05 "Geist Sans", Inter, ...`.
2. Cap font weights: search for `font-weight: 8` / `font-weight: 9` and lower to 600 or 700.
3. Introduce the radius tokens (`--r-xs` … `--r-pill`) and migrate the literal `4px` / `6px` / `8px` / `10px` / `22px` / `28px` / `999px` border-radius values.
4. Introduce the new color tokens above; alias the existing `--paper`, `--ink`, `--ktv-bg`, `--ktv-accent`, `--ktv-accent-2` to the new tokens for one release before deleting them.
5. Swap focus ring from cool blue `rgba(94, 176, 255, 0.78)` to `--focus-ring`.
6. Migrate lyric effect palettes to the warm set; keep the existing `data-effect` API.
7. Replace emoji icons in `App.tsx` with `lucide-react` imports.
8. Wire `Geist` and `Geist Mono` via the `<link>` snippet above and update the root `font-family` chain.

When closing each item, append a row to the Decisions Log so the next agent can see the conversion progress.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-28 | Adopt Studio Paper + Warm Stage as the two-surface model | Avoids the current visual split between paper-warm Studio and cyan-neon KTV that have no shared identity. |
| 2026-04-28 | Single accent: warm coral `#C85A2A` (Studio) / `#F2864A` (Stage) | Replaces the four-way drift between blue `#1479ff`, cyan `#57f1ff`, focus `rgba(94,176,255)`, and segment selected `#263f54`. Warm hue maps to voice/breath, the product's core subject. |
| 2026-04-28 | Geist Sans for UI, Geist Mono for numerics, retire Georgia display hero | The current giant Georgia headline reads as magazine, not utility tool. Geist 600 at 44px keeps presence without dominating. |
| 2026-04-28 | Cap font weights at 700 (display 600) | The 800–950 range across labels and bodies makes the whole UI shout. |
| 2026-04-28 | Pin radius scale to 6 tokens | Six values from a 12-value sprawl. Keeps card / pill / drawer rhythm consistent. |
| 2026-04-28 | Lucide React for all chrome icons | Removes emoji rendering inconsistency on Windows/macOS. |
| 2026-04-28 | One HoverFill surface per group | Keeps existing springen-style group hover; bans per-item hover bg that the codebase regresses to. |
