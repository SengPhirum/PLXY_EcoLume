# EcoLume brand kit

Single source of truth for the EcoLume mark, icons, and colour tokens. The
backend serves this folder at `/brand`, and the documentation site copies it to
`assets/brand/` at build time — update files here, never the copies.

## The mark

A luminaire head casting a light pool, carrying a lightning bolt in negative
space, with two connectivity arcs rising from the head:

| Element | Meaning |
|---|---|
| Lamp head + light pool | The street light itself |
| Connectivity arcs | The IoT uplink (cellular or LoRaWAN) reporting from the pole |
| Lightning bolt in the beam | Metered energy and adaptive dimming |

## Files

| File | Use |
|---|---|
| `ecolume-mark.svg` | Primary app tile (gradient), 64×64 grid — headers, README, app icon |
| `ecolume-glyph.svg` | Single-colour glyph, no tile, inherits `currentColor` — inline UI icons |
| `ecolume-logo.svg` | Horizontal lockup: tile + wordmark + descriptor, 320×72 |
| `favicon.svg` | Simplified mark with heavier strokes for 16–48 px rendering |
| `favicon.ico` | 16/32/48 PNG-in-ICO bundle for legacy browsers |
| `favicon-16/32/48.png`, `icon-192.png`, `icon-512.png` | Raster favicons and web-app icons |
| `apple-touch-icon.png` | 180×180 full-bleed (iOS applies its own corner mask) |
| `maskable-512.png` | Android adaptive icon, artwork inside the 80% safe zone |
| `og-image.png` | 1200×630 social preview card |

Raster files are generated from the SVGs by `generate-icons.mjs` and committed,
so nothing has to be built at install or deploy time. Regenerate them only when
the SVG sources change.

## Colour tokens

DodgerBlue `#1E90FF` is the system-wide primary. Every pairing below is measured
against WCAG 2.1 contrast minimums.

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--brand` | `#1E90FF` | Primary accent, links, active states, series 1 | 6.09:1 on `#060B14` |
| `--brand-strong` | `#0B67C7` | Filled controls that carry white text | 5.56:1 with `#FFFFFF` |
| `--brand-deep` | `#0B5FB0` | Brand text on light backgrounds | 6.41:1 on `#FFFFFF` |
| `--brand-soft` | `#7FC0FF` | Muted accents, chart fills, hover tints | — |
| `--brand-ink` | `#04121F` | Text and icons on a `--brand` fill | 5.82:1 on `#1E90FF` |

White text directly on `#1E90FF` reaches only 3.24:1, so filled brand buttons
use `--brand-ink`, and any white-on-blue control uses `--brand-strong`.

Status hues stay distinguishable by hue *and* by label or icon, never by colour
alone: online `--brand`, offline `#FFB020`, fault `#FF6B61`, maintenance
`#9B8CFF`.

## Usage rules

- Keep clear space of at least 25% of the tile height around the lockup.
- Do not recolour the mark outside the tokens above, rotate it, or add effects.
- Inline the glyph rather than the tile when a single-colour icon is needed;
  when inlining any SVG that defines `id`s into an HTML page, prefix them so
  they cannot collide with other inline SVGs on the same page.
