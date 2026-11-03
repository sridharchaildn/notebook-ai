# Notebook AI Web — UI/UX Standards

This file covers web UI/UX rules only. Repo-wide architecture and ownership rules live in the root [`AGENTS.md`](../../AGENTS.md) and apply here first.

This document defines the UI/UX standards for the Notebook AI web app (Next.js). All pages, components, and future features must follow these conventions to maintain visual consistency with the desktop app.

---

## Design System: Neutral Premium (Linear-inspired)

Inspired by **Linear**, **Vectal**, and **Notion**. The aesthetic is premium, minimal, and clean with careful use of color, generous spacing, and editorial typography.

---

## Shared Token System

Colors, shadows, and animation tokens are defined in `packages/theme/src/tokens.css`. Both the web and desktop apps import this file. **Never hardcode colors — always use CSS variables.**

Light mode values live in `:root`, dark mode in `:root[data-theme='dark']`. Theme is toggled via `data-theme` attribute on `<html>`.

### Key Tokens

| Token              | Purpose                          |
|--------------------|----------------------------------|
| `--bg`             | Page background                  |
| `--surface`        | Card/panel backgrounds           |
| `--surface-sunken` | Input fields, inset areas        |
| `--border`         | Subtle borders (8% opacity)      |
| `--text`           | Primary text                     |
| `--text-secondary` | Descriptions, labels             |
| `--text-tertiary`  | Placeholders, meta               |
| `--primary`        | CTA buttons, active states       |
| `--accent`         | Focus rings, highlights (blue)   |
| `--success`        | Connected/check states           |

---

## Typography

- **Font Family**: `Inter` via Google Fonts, fallback `-apple-system, BlinkMacSystemFont, sans-serif`
- **Font smoothing**: Always `-webkit-font-smoothing: antialiased`

### Scale

| Element              | Size         | Weight | Letter Spacing | Example               |
|----------------------|-------------|--------|----------------|------------------------|
| Hero heading         | clamp(2.4–3.6rem) | 700 | `-0.035em`  | Landing page headline  |
| Section titles       | `1.75rem`    | 700    | `-0.03em`      | "Why teams switch"     |
| Section labels       | `0.72rem`    | 700    | `0.08em`       | "FEATURES", "COMPARE"  |
| Card headings        | `0.98rem`    | 650    | `-0.02em`      | "Fast by design"       |
| Body text            | `0.88–0.95rem` | 400–500 | `-0.006em` | Descriptions           |
| Badges               | `0.74rem`    | 500    | `0.005em`      | Hero badges            |
| Table headers        | `0.72rem`    | 600    | `0.06em`       | Uppercase table heads  |
| Footer text          | `0.76–0.84rem` | 500–600 | normal     | Links, copyright       |

**Rules:**
- Headlines use negative letter-spacing (`-0.02em` to `-0.035em`) for the Linear look
- Section labels are `uppercase` with wide tracking (`0.06–0.08em`) in accent color
- Body text uses subtle negative tracking (`-0.006em`) for density
- Headings line-height: `1.04–1.15`; body: `1.6–1.7`

---

## Spacing & Layout (Vectal-inspired)

| Area                 | Padding/Gap    | Notes                            |
|----------------------|---------------|----------------------------------|
| Container            | `max-width: 1120px`, `48px 20px` | Generous vertical breathing room |
| Hero section         | `64px 48px`    | Premium interior padding         |
| Between sections     | `48px`         | High breathing room              |
| Card interior        | `22–28px`      | Comfortable internal spacing     |
| Grid gaps            | `14px`         | Tight but breathable card gaps   |
| Stats bar items      | Centered, flex | With 1px dividers between        |
| CTA section          | `64px 32px`    | Generous centered padding        |

**Rules:**
- Sections should feel spacious — never crowd content
- Use `section-header-block` (centered label + title + subtitle) above card grids
- Feature grids use `grid-3` (3 columns) or `grid-2` (2 columns)

---

## Component Patterns

### App Logo
- Shared component: `components/AppLogo.tsx`
- Matches desktop: `BookOpen` icon (white) inside a rounded square with `var(--primary)` background
- Use at sizes: `20px` (footer), `24px` (page headers), `26px` (nav), `40px` (CTA)

### Nav Bar
- Sticky, with `backdrop-filter: blur(14px)`
- Left: AppLogo + "Notebook AI", Right: ThemeToggle + buttons
- Background: `color-mix(in srgb, var(--bg) 78%, transparent)`

### Hero Section
- Contained in a `var(--surface)` card with `16px` border-radius
- Gradient text on key phrase using `gradient-text` class
- Badges below CTA buttons (pill-style with icons)

### Feature Cards
- `panel panel-hover` classes on `UICard`
- Icon in `feature-icon` container (accent-colored rounded square, 40×40px)
- Title → description layout

### BYOK / Provider Section
- Centered `byok-panel` with key icon, title, subtitle
- Provider cards: squared (140px), centered icon + uppercase label
- Dashed border for "coming soon" card
- Providers: OpenAI, OpenRouter, + More Soon

### Stats Bar
- 4 stats in a flex row with `stat-divider` separators
- Large bold number + small label below
- e.g., "0ms", "$0/mo", "100%", "BYOK"

### Comparison Table
- Standard HTML `<table>` with `table` class
- Headers: uppercase, small, wide tracking
- Check items: `check-icon` class (green with CheckIcon)
- Row hover with subtle background

### CTA Section
- Centered card with AppLogo, title, subtitle, CTA button
- `64px` vertical padding

### Footer
- `site-footer` class with `footer-inner` flex container
- Left: AppLogo + brand, Center: links, Right: copyright

### Theme Toggle
- `theme-toggle-btn`: 34×34px, icon-based (sun/moon SVG)
- Persists to `localStorage` key `notebook_theme`
- Sets `data-theme` on `<html>` element

---

## Animations

| Animation              | Duration | Easing                    | Class                          |
|-----------------------|----------|---------------------------|--------------------------------|
| Entrance (fade+rise)   | 600ms    | `cubic-bezier(0.16,1,0.3,1)` | `animate-fade-in-up`      |
| Staggered entrance     | +120ms   | Same                      | `animate-fade-in-up-delay-1/2/3` |
| Gradient shimmer       | 5s       | linear, infinite          | `gradient-text` (auto)         |
| Background orbs        | 22–28s   | ease-in-out, infinite     | Shell `::before/::after`       |
| Hover lift             | 200ms    | ease-out                  | `panel-hover` (auto)           |
| Theme toggle rotation  | 300ms    | spring bezier             | `theme-toggle-btn:hover`       |
| Spinner                | 700ms    | linear                    | `spinner` class                |

**Rules:**
- Never exceed 600ms for entrance, 200ms for hover
- Use `translateY(-2px)` for card hover lifts
- Background orbs are very subtle (6–8% opacity)

---

## Shadows

Layered shadows matching the design system. Use `var(--shadow-*)` tokens only — never hardcode.

| Token          | Usage                |
|----------------|---------------------|
| `--shadow-xs`  | Stats bar, pills     |
| `--shadow-sm`  | Buttons, badges      |
| `--shadow-md`  | Hero card, panels    |
| `--shadow-lg`  | Modals               |
| `--shadow-focus` | Input/button focus |

---

## Border Radius

| Radius   | Usage                                           |
|----------|-------------------------------------------------|
| `8px`    | Buttons, inputs, nav items                      |
| `10px`   | Feature icon containers                         |
| `12px`   | Cards, provider cards, stats bar                |
| `16px`   | Hero section, CTA section, BYOK panel           |
| `999px`  | Badges, pills (fully rounded)                   |

---

## File Structure

```
apps/web/app/
├── layout.tsx              # Root layout, imports theme tokens
├── globals.css             # All page-level styles
├── components/
│   ├── AppLogo.tsx         # Shared logo component (BookOpen)
│   ├── ThemeToggle.tsx     # Sun/moon icon toggle
│   └── Footer.tsx          # Branded footer
├── (marketing)/page.tsx    # Landing page
├── auth/signup/page.tsx    # Signup flow
├── onboarding/page.tsx     # Onboarding wizard
└── settings/page.tsx       # Settings page
```

---

## Do's and Don'ts

### ✅ Do
- Use CSS custom properties for ALL colors
- Use `letter-spacing: -0.02em` on headings
- Use `uppercase` + wide letter-spacing for section labels
- Test both light and dark mode for every change
- Use generous section spacing (Vectal-inspired)
- Use centered `section-header-block` for section intros
- Use inline SVG icons — avoid icon font libraries
- Emphasize BYOK and provider flexibility in messaging

### ❌ Don't
- Don't hardcode hex colors in components
- Don't use saturated primary colors for backgrounds
- Don't use harsh shadows — always use layered tokens
- Don't use icon libraries (lucide, etc.) — inline SVG only for web
- Don't crowd sections — maintain high breathing room
- Don't use `border-radius` values outside the defined scale
- Don't forget to handle both light + dark mode
