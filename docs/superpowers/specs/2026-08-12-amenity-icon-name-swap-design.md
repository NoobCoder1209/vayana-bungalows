# Swap amenity/service icons + names on Home and Stays

**Date:** 2026-08-12
**Repo:** NoobCoder1209/vayana-bungalows (main @ 9c343fa)
**Branch:** `feature/amenity-icon-name-swap`

## Goal

Replace the icons AND labels of the amenity/service lists, keeping the existing
DOM structure, CSS, and i18n machinery. Two lists:

### Home — "services" section (stays 6 tiles)
Currently: Transfer, Housekeeper, Wifi & internet, Laundry, Breakfast in bed,
Swimming pool. Replace with:

1. Free WiFi
2. Air conditioning
3. Fully Equipped Kitchen
4. Free parking
5. Smart TV
6. BBQ

Each tile KEEPS its title + descriptive body sentence (owner decision). New
body copy written to match the existing warm, concise tone. Titles + bodies are
i18n-keyed → updated in BOTH `en.json` and `bg.json` (translated to Bulgarian).

### Stays — "amenities" grid (grows 8 → 12 chips)
Currently: King-size bed, Private plunge pool, Ocean view, Fibre Wi-Fi,
24-hour butler, Breakfast in bed, Mini-bar, Private deck. Replace the WHOLE grid
with these 12 (the 6 Home items + 6 Stays-only), in this order:

1. Free WiFi
2. Air conditioning
3. Fully Equipped Kitchen
4. Free parking
5. Smart TV
6. BBQ
7. Coffee Machine
8. Washing Machine
9. Iron
10. Hair Dryer
11. Premium Linens & Towels
12. Baby Crib

Amenity chips are hardcoded English `<span>` (no i18n) — matches current state.

## Icons (final set, from ~/Downloads/vayana-amenity-icons-final.html)

House style preserved per context:
- **Home** `<svg>`: `viewBox="0 0 24 24" width="36" height="36" fill="none"
  stroke="currentColor" stroke-width="1.3"` (+ `stroke-linecap/linejoin=round`
  where the new paths need it; existing ones omit it, harmless to add).
- **Stays** `<svg>`: same but `width/height="22"` and `stroke-width="1.5"`.

Icon inner-paths are the approved variants (WiFi A, AC A, Kitchen A, Parking C,
Smart TV A, BBQ A, Coffee B, Washing A, Iron A, Hair dryer A, Linens
towel-on-rail C, Baby crib A). The SAME inner paths are reused in both sizes —
only the wrapper `<svg>` width/height/stroke-width differ per context.

## Files changed

1. **`index.html`** — replace the 6 `<article class="service-tile">` icon SVGs +
   the 6 `data-i18n` key stems. The keys are renamed to match the new concepts
   so the markup is self-documenting:
   - `airport_*` → `wifi_*`? — NO. To avoid churn and keep diffs reviewable, the
     6 tiles get NEW semantic key stems: `wifi`, `aircon`, `kitchen`, `parking`,
     `tv`, `bbq`. Old stems (`airport/housekeeper/wifi/laundry/breakfast/pool`)
     are removed from both locales. (One old stem `wifi` is reused with new copy.)
   - Each tile: swap the inline `<svg>` inner path, set `<h5 data-i18n="home.services.<stem>_title">`, `<p data-i18n="home.services.<stem>_body">`.

2. **`stay/index.html`** — replace the entire `.bungalow-amenities__grid` inner
   (8 chips → 12 chips) with the 12 new `<div class="amenity">` blocks (22px icons).

3. **`premier-oceanview-villa/index.html`**, **`deluxe-hilltop-residence/index.html`**,
   **`premier-beachfront-suite/index.html`** — identical grid replacement. The
   grid block is byte-identical across all 4 pages today (verified md5), so the
   same 12-chip block is dropped into all four.

4. **`locales/en.json`** — replace the 6 old `home.services.*_title/_body` pairs
   with 6 new ones (`wifi/aircon/kitchen/parking/tv/bbq`). Keep `eyebrow`+`title`.

5. **`locales/bg.json`** — same 6 new pairs, translated to Bulgarian.

## New Home body copy (EN)

- **Free WiFi** — "Fast fibre throughout, from the villa to the beach."
- **Air conditioning** — "Individually controlled cooling in every room."
- **Fully Equipped Kitchen** — "Full cooktop, cookware, and everything to self-cater."
- **Free parking** — "Private on-site parking, no charge, right at your door."
- **Smart TV** — "Streaming-ready smart TVs with your favourite apps."
- **BBQ** — "Your own grill for long evenings under the stars."

(BG translations written to mirror these; finalised in the plan step.)

## No CSS changes

- `.services__grid` = `repeat(3,1fr)` → 6 tiles = 3×2, unchanged count. Its
  per-tile border-seam resets (2n / last-2) still hold for 6.
- `.bungalow-amenities__grid` = `repeat(4,1fr)`, no seam logic → 12 = 4×3 wraps
  cleanly with zero CSS edits. Responsive breakpoints (2-col, 1-col) already
  count-agnostic.

## What is explicitly NOT changing

- Section wrappers, headings, eyebrows, `reveal` animations, containers.
- The `home.services.eyebrow` + `home.services.title` strings (the section
  heading copy stays — only the 6 tiles change).
- Any JS. No behavioural change.
- Amenity chips stay hardcoded EN (not converted to i18n) — matches today.

## Verification

1. `npm run build` clean (i18n plugin transforms markers at build; a missing
   BG key would fail here).
2. `npm test` — full suite (currently green); no logic touched, expect no
   regressions. `npm run i18n:lint` MUST pass (enforces EN↔BG key symmetry +
   that every `data-i18n` marker resolves).
3. Playwright (Firefox), serve `dist` on a local port:
   - Home `/`: 6 service tiles show new icons + names + bodies; layout intact
     (3×2). Toggle `/bg/` — Bulgarian titles/bodies render (no English leak, no
     missing-key blanks).
   - `/stay/`: amenities grid shows 12 chips (4×3), new icons, correct names.
   - Each of the 3 bungalow detail pages: same 12 chips.
   - Narrow viewport: grids collapse to 2-col then 1-col without overflow.
4. Rebuild from source only — never edit `dist/`.

## Branch / PR

`feature/amenity-icon-name-swap` → build/test/lint → Playwright eyeball →
commit (only the 6 files above; never `.superpowers/`, `bookings.json`, `dist/`)
→ PR → review on request → squash-merge on approval → sync main.
