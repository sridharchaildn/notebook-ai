# Notebook AI Desktop — UI/UX Standards

This file covers desktop UI/UX rules only. Repo-wide architecture and ownership rules live in the root [`AGENTS.md`](../../AGENTS.md) and apply here first.

This document defines the UI/UX standards, colors, typography, and component patterns for the Notebook AI desktop app. All future features and screens must follow these conventions to maintain visual consistency across both desktop and web apps.

---

## Design System: Neutral Premium (Linear-inspired)

Inspired by **Linear**, **Notion**, and **Raycast**. The aesthetic is premium, minimal, and clean with careful use of color, shadow, and generous spacing.

> **Cross-app consistency**: The web app (`apps/web/AGENTS.md`) shares the same token system (`packages/theme/src/tokens.css`). Desktop and web must stay aligned on colors, typography, and component naming.

---

## Color Tokens

All colors are defined as CSS custom properties in `src/styles.css` and adapt automatically to light/dark mode via `data-theme`.

### Light Mode

| Token               | Value                         | Usage                               |
|----------------------|-------------------------------|--------------------------------------|
| `--bg`               | `#F7F7F8`                     | Page background                      |
| `--surface`          | `#FFFFFF`                     | Panel/card backgrounds               |
| `--surface-raised`   | `#FFFFFF`                     | Elevated cards, modals               |
| `--surface-sunken`   | `#F2F2F5`                     | Input fields, code blocks            |
| `--border`           | `rgba(0,0,0,0.08)`           | Subtle borders between panels        |
| `--border-strong`    | `rgba(0,0,0,0.14)`           | Hover/focus borders                  |
| `--text`             | `#171717`                     | Primary text                         |
| `--text-secondary`   | `#6B6B76`                     | Secondary labels, descriptions       |
| `--text-tertiary`    | `#9898A5`                     | Placeholders, meta text              |
| `--primary`          | `#171717`                     | Buttons, active states (neutral)     |
| `--primary-hover`    | `#2C2C2C`                     | Hovered primary elements             |
| `--primary-subtle`   | `rgba(0,0,0,0.04)`           | Hover backgrounds, active states     |
| `--accent`           | `#3B82F6`                     | Focus rings, rare highlights         |
| `--success`          | `#22C55E`                     | Connected/success states             |
| `--warning`          | `#F59E0B`                     | API key/warning states               |
| `--danger`           | `#EF4444`                     | Destructive actions, stop buttons    |

### Dark Mode (True Black — Linear-style)

| Token               | Value                         | Notes                                |
|----------------------|-------------------------------|--------------------------------------|
| `--bg`               | `#000000`                     | True black background                |
| `--surface`          | `#0A0A0A`                     | Panel backgrounds                    |
| `--surface-raised`   | `#111111`                     | Elevated cards                       |
| `--surface-sunken`   | `#050505`                     | Input fields, code blocks            |
| `--border`           | `rgba(255,255,255,0.08)`     | Very subtle borders                  |
| `--primary`          | `#FFFFFF`                     | White for dark mode buttons          |
| `--accent`           | `#60A5FA`                     | Subtle blue for focus/highlights     |

---

## Typography

- **Font Family**: `Inter` (loaded via Google Fonts)
- **Fallback**: `-apple-system, BlinkMacSystemFont, sans-serif`
- **Monospace** (AI output, code): `'SF Mono', 'Fira Code', 'Cascadia Code', monospace`
- **Font smoothing**: Always use `-webkit-font-smoothing: antialiased`

### Scale

| Element              | Size       | Weight | Letter Spacing | Example                |
|----------------------|------------|--------|----------------|------------------------|
| Section headers      | `0.82rem`  | 700    | `0.04em`       | `AI COPILOT`, `NOTES`  |
| Note titles          | `0.88rem`  | 600    | `-0.01em`      | Note list items        |
| Body text            | `0.95rem`  | 400    | normal         | Editor content         |
| Labels/meta          | `0.78rem`  | 500    | `0.03em`       | Timestamps, hints      |
| Tag pills            | `0.68rem`  | 600    | `0.04em`       | Uppercase tag badges   |
| AI output            | `0.84rem`  | 400    | normal         | Monospace streaming    |
| Editor title input   | `1.14rem`  | 600    | `-0.02em`      | Linear-style headings  |

**Rules:**
- Headlines use `letter-spacing: -0.02em` for the Linear look
- Section headers are `uppercase` with wide tracking (`0.04em`)
- Never use font sizes below `0.68rem`

---

## Shadows (Linear-style Layered)

Shadows use dual layers for depth. Dark mode uses stronger shadows since contrast is harder on black.

| Token          | Light Mode                                                        | Usage               |
|----------------|------------------------------------------------------------------|----------------------|
| `--shadow-xs`  | `0 1px 2px rgba(0,0,0,0.04)`                                    | Subtle card lift     |
| `--shadow-sm`  | `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)`       | Buttons, toggles     |
| `--shadow-md`  | `0 4px 8px -2px rgba(0,0,0,0.06), 0 2px 4px -2px rgba(0,0,0,0.04)` | Cards, panels    |
| `--shadow-lg`  | `0 12px 24px -4px rgba(0,0,0,0.08), ...`                        | Modals               |
| `--shadow-xl`  | `0 24px 48px -8px rgba(0,0,0,0.10), ...`                        | Settings modal       |
| `--shadow-focus` | `0 0 0 2px rgba(0,0,0,0.12)`                                   | Input/button focus   |

**Rules:**
- Never use `box-shadow: 0 0 10px black` or flat/harsh shadows
- Always use negative spread for "Linear" effect: `-2px`, `-4px`, `-8px`
- Dark mode shadows use higher opacity (0.4–0.8)

---

## Animation Tokens

Defined in `packages/theme/src/tokens.css` and shared with the web app.

| Token              | Value                                    | Usage                 |
|--------------------|------------------------------------------|-----------------------|
| `--duration-fast`  | `120ms`                                  | Hover transitions     |
| `--duration-normal`| `200ms`                                  | Panel opens, toggles  |
| `--duration-slow`  | `320ms`                                  | Modal entrance        |
| `--ease-out`       | `cubic-bezier(0.16, 1, 0.3, 1)`         | Smooth deceleration   |
| `--ease-spring`    | `cubic-bezier(0.34, 1.56, 0.64, 1)`     | Bouncy micro-actions  |

---

## Border & Corner Radius

| Radius   | Usage                                                   |
|----------|---------------------------------------------------------|
| `8px`    | Buttons, inputs, note list items, tags, toggles         |
| `10px`   | Cards (provider chips, AI action cards)                 |
| `12px`   | Panel sections (AI panel, provider panel)               |
| `14px`   | Settings modal outer border                             |
| `999px`  | Pills, badges (fully rounded)                           |

**Rules:**
- **No harsh borders.** Use `var(--border)` (8% opacity) for structural lines
- Prefer background color shifts over visible borders for separation
- Active states use left-border accent: `border-left: 3px solid var(--primary)`
- Input focus always adds `var(--shadow-focus)` ring

---

## Component Patterns

### Buttons

| Type        | Style                                                |
|-------------|------------------------------------------------------|
| `solid-btn` | Filled neutral (dark text on surface), `8px` radius  |
| `ghost-btn` | Transparent, border, hover → subtle bg               |
| `cta-btn`   | Subtle bg, dark text, hover → filled neutral         |
| `footer-btn`| No border, left-aligned, icon + text, hover → subtle |

### Inputs
- Background: `var(--surface-sunken)`
- No visible border by default
- Focus: `border-color: var(--primary)` + `var(--shadow-focus)` ring
- Always use `font-family: inherit`

### Cards
- Background: `var(--surface-sunken)` or `var(--surface-raised)`
- Border: `1px solid var(--border)` (very subtle)
- Hover: `border-color: var(--primary)` + slight translateY
- Content uses icon + title + description pattern

### Status Badges
- `.connected-badge.success` — Green bg + text for connected states
- `.connected-badge.warning` — Amber bg + text for API key states
- Always `999px` radius, uppercase, small font

### Segmented Controls (Toggles)
- Container: `var(--surface-sunken)` background, `8px` radius
- Active segment: `var(--surface)` background with `var(--shadow-xs)`
- Active text: `var(--primary)` color

### App Logo
- White `BookOpen` icon (or SVG equivalent) inside a rounded square with `var(--primary)` background
- Used in splash screen, sidebar header, and settings modal
- Consistent with web app's `AppLogo` component
- Sizes: `32px` (sidebar), `48px` (splash), `24px` (settings header)

### BYOK / Provider Section (Settings)
- Emphasize **Bring Your Own Key** model throughout the settings UI
- Provider cards: icon + name + API key input + status badge
- Supported: **OpenAI**, **OpenRouter** (+ "More soon" placeholder)
- Each provider card uses `var(--surface-sunken)` background with subtle border
- Status badges: `.connected-badge.success` (green) or `.connected-badge.warning` (amber)
- Key inputs use `type="password"` with a toggle reveal button
- No subscription messaging — match web landing page's BYOK emphasis

---

## Layout Structure

```
┌─ Sidebar (280px) ──────────┬─ Editor ──────────────────┬─ Right Rail (340px) ──┐
│ App Title (uppercase)      │ Title Input               │ AI COPILOT header     │
│ Search Bar                 │ Tags Input                │ Summarize card        │
│ [New Note] button          │ Status Pill               │ Rewrite card          │
│ Note List (scrollable)     │ Transcription Bar         │ Action Items card     │
│   - active = left border   │ Editor Textarea           │ AI Output (monospace) │
│   - tag pills              │                           │                       │
│ ─── footer ───             │                           │                       │
│ ⚙ Settings                │                           │                       │
│ ? Help & Documentation    │                           │                       │
└────────────────────────────┴───────────────────────────┴───────────────────────┘
```

- Sidebar: `var(--surface)` background, right border
- Editor: `var(--bg)` background (slightly recessed)
- Right Rail: `var(--surface)` background, left border
- No rounded panel corners on the main 3-column layout — use flat edge-to-edge panels
- Settings are in a modal, NOT in the main layout

---

## Settings Modal

- Overlay: black at 50% opacity with `backdrop-filter: blur(8px)`
- Modal: `720px` wide, `14px` radius, `var(--shadow-xl)`
- Left tabs with icon + label, active tab has indigo left-border
- Content area with `24px` padding
- Footer with app version + Close button

---

## Animation Guidelines

| Animation    | Duration | Easing    | Usage                          |
|-------------|----------|-----------|--------------------------------|
| `rise`       | 200–320ms | ease     | Panel entrance animations      |
| `fadeIn`     | 180ms    | ease      | Modal overlay fade-in          |
| `scaleIn`    | 220ms    | ease      | Modal content scale + fade     |
| `spin`       | 1s       | linear    | Loading spinners               |
| `pulse`      | 1.6s     | ease-in-out | Recording indicator blink    |
| Hover transitions | 120ms | ease   | All interactive state changes  |

**Rules:**
- Never exceed 320ms for UI transitions
- Use `transform: translateY(-1px)` for hover lifts (not larger values)
- Avoid motion on `prefers-reduced-motion` (to be added)

---

## Do's and Don'ts

### ✅ Do
- Use token variables for ALL colors — never hardcode hex values in components
- Use `letter-spacing: -0.02em` on headlines
- Use `uppercase` + wide letter-spacing for section headers
- Test both light and dark mode for every new component
- Use subtle background shifts (`var(--surface-sunken)` vs `var(--surface)`) instead of borders
- Use neutral accent consistently for all interactive highlights

### ❌ Don't
- Don't use purple, indigo, or any saturated colors for buttons or backgrounds
- Don't use pure `#000000` in light mode or `#FFFFFF` in dark mode for text
- Don't use opaque borders (keep at 8–14% opacity)
- Don't use harsh drop shadows — always use layered, spread-negative shadows
- Don't use `border-radius` values besides those in the scale above
- Don't use colors not defined in the token system
- Don't add inline styles for colors — always use CSS classes or variables
- Don't use dividers/`<hr>` — use spacing or background shifts
- Don't use different design tokens than the web app — keep `packages/theme/src/tokens.css` as the single source of truth
