# Oltremani — Brand Guide

Source: https://www.oltremani.it  
Last scraped: 2026-06-27

---

## Identity

**Name:** Oltremani  
**Tagline:** Attiviamo Umanità  
**Type:** Italian social association (refugee integration / community)  
**Mood:** Warm, human, inclusive, community-oriented, clean, hopeful

---

## Colors

### Primary — Orange (brand accent)
- **Hex:** `#E8921E`
- **OKLCH:** `oklch(0.69 0.168 55)`
- **Usage:** Logo arc, primary buttons, active nav items, badges, CTA, highlights
- **Notes:** Warm amber-orange, saturated but not neon. Same color as the iconic arch/rainbow icon.

### Secondary — Navy Blue (brand main)
- **Hex:** `#1E3271`
- **OKLCH:** `oklch(0.28 0.115 263)`
- **Usage:** Logo text, sidebar background, headings, text on light backgrounds
- **Notes:** Deep, rich navy. Professional but warm. Used for the "curvablu" decorative element.

### Supporting
| Role | Hex | OKLCH | Notes |
|---|---|---|---|
| Background | `#FAF8F5` | `oklch(0.975 0.01 85)` | Warm off-white/cream |
| Card | `#FFFFFF` | `oklch(1 0 0)` | Pure white |
| Foreground/text | `#1A2452` | `oklch(0.22 0.08 263)` | Navy-tinted dark |
| Muted text | `#6B7280` | `oklch(0.55 0.02 263)` | Gray with blue tint |
| Border | `#E2E4EC` | `oklch(0.90 0.02 263)` | Subtle blue-grey border |
| Sidebar hover | `#283E84` | `oklch(0.35 0.10 263)` | Lighter navy |
| Orange light | `#FEF3E2` | `oklch(0.96 0.04 75)` | Orange tint bg for badges |
| Destructive | red | `oklch(0.58 0.22 27)` | Keep standard red |

---

## Typography

### Heading / Brand font — Raleway
- **Package:** `@fontsource/raleway`
- **Weights:** 400, 500, 600, 700, 800
- **CSS var:** `--font-sans` (headings) or use `font-serif` Tailwind class (mapped in app to brand font)
- **Usage:** Page titles, sidebar logo, auth headlines, card headers
- **Notes:** Geometric humanist sans-serif. Best match found for the wordmark. Used at 700–800 for display.

### Body font — Inter
- **Package:** `@fontsource/inter`
- **Weights:** 400, 500, 600, 700
- **CSS var:** `--font-sans`
- **Usage:** All body copy, form labels, table data, badges

### Hierarchy (admin CRM context)
```
Page title (h1):  Raleway, 700, 1.5rem (font-serif class)
Section title (h2): Raleway, 600, 1.25rem
Card title: Inter, 600, 0.875rem
Body: Inter, 400, 0.875rem
Label: Inter, 500, 0.75rem uppercase tracking-wide
Muted: Inter, 400, 0.75rem, muted-foreground color
```

---

## Logo Assets

| Asset | URL |
|---|---|
| Color logo (full) | `https://www.oltremani.it/wp-content/uploads/2025/11/logo-color2.png` |
| White logo | `https://www.oltremani.it/wp-content/uploads/2025/11/logo-white-2-1.png` |
| Icon only (arc) | `https://www.oltremani.it/wp-content/uploads/2025/11/logo-h2.png` |
| Orange arc divider | `https://www.oltremani.it/wp-content/uploads/2025/11/curva-arancio.png` |
| Navy arc divider | `https://www.oltremani.it/wp-content/uploads/2025/11/curvablu.png` |

### Logo anatomy
- **Icon:** Thick orange arch/rainbow — a donut half-circle shape representing outstretched hands / human bridge
- **Wordmark:** "OLTREMANI" in navy, bold geometric sans-serif (all caps, wide tracking)
- **Tagline:** "ATTIVIAMO UMANITÀ" below wordmark, lighter weight, smaller

### Inline SVG icon (for sidebar / favicon)
```svg
<svg viewBox="0 0 48 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 28 C0 12.536 10.745 0 24 0 C37.255 0 48 12.536 48 28 L36 28 C36 19.163 30.627 12 24 12 C17.373 12 12 19.163 12 28 Z" fill="#E8921E"/>
</svg>
```

---

## UI Patterns

### Border radius
- `--radius: 0.875rem` (cards, dialogs)
- Inputs: `0.5rem`
- Badges: `9999px` (pill)
- Buttons: `0.5rem`

### Spacing
- Card padding: `1.5rem`
- Section gap: `1.5rem–2rem`
- Form field gap: `1rem`

### Cards
- White background, `1px` border in `--border`, `box-shadow: 0 1px 3px rgba(30,50,113,0.06)`
- Border radius: `0.875rem`
- No heavy shadows — clean, minimal

### Sidebar (navy)
- Background: `oklch(0.28 0.115 263)` — navy
- Text: near-white `oklch(0.97 0.01 265)`
- Active item: orange background `oklch(0.69 0.168 55)` or left border accent
- Hover: lighter navy `oklch(0.35 0.10 263)`
- Group labels: semi-transparent white, uppercase, small

### Buttons
- **Primary:** Orange bg `#E8921E`, white text, hover darken ~10%
- **Secondary:** White bg, navy border, navy text
- **Ghost:** Transparent, navy text, navy hover bg at 8% opacity
- **Destructive:** Red standard

### Badges / Status
- `new` → blue/navy outline
- `active` → green
- `rejected` → red
- `old` → gray
- Subscription active → orange/warm
- In validation → amber

---

## Site Technology
- WordPress + Elementor (page builder)
- WPML (multilingual: IT/EN/FR)
- GiveWP (donations)
- Yoast SEO

---

## Application Notes
- CRM is an internal admin tool — use the brand colors confidently but keep the UI clean and data-dense
- Sidebar should feel like "Oltremani branded" (navy) not generic grey
- Orange sparingly: primary actions, active states, key stats/badges only
- White cards on warm cream background (#FAF8F5)
- No dark mode needed for MVP
