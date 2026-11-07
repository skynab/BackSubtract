# Known issues

Problems noticed along the way, to fix later. Remove an entry once it's fixed (the commit that fixes it is the record).

## Indonesian: the top bar is wider than a 320 px phone

**Where:** top bar, Indonesian only, screens 320 px wide (iPhone SE 1st gen and similar small Android phones). Found 2026-11-07.

**What happens:** the page is 338 px wide, so it scrolls sideways by 18 px and the Donate heart sits partly off the right edge.

**Why:** the language picker is as wide as the chosen language's name (`field-sizing: content` on `.language select` in `src/app/app.css`), and "Bahasa Indonesia" is by far the longest label in `LANGUAGES` (`src/i18n/index.ts`). Measured at 320 px:

| Language | Picker width | Donate button's right edge |
|---|---|---|
| Indonesian | 137 px | 338 px (overflows) |
| Bengali | 56 px | 308 px |
| English | 69 px | 308 px |
| Russian | 76 px | 308 px |

Below 480 px the Donate button already shows only its heart, and below 420 px the globe icon is already hidden, so those don't help any further. The brand ("BackSubtract", 139 px), the picker and the heart together just don't fit.

**Note:** the Donate button only shows when a donate link is set (or under `npm run dev`), so a build without donate links may not overflow. It should still fit when they're set.

**To reproduce:** `npm run dev`, set the browser to 320 px wide, choose Bahasa Indonesia, and check that `document.documentElement.scrollWidth` is 338 instead of 320.

**Possible fixes:**
- Cap the picker's width at the smallest sizes (e.g. `max-width: 7em` under `@media (max-width: 360px)`), relying on its `text-overflow: ellipsis`. Check that browsers really draw the ellipsis inside a `<select>`.
- Hide the "BackSubtract" text next to the logo at the smallest sizes. It frees about 110 px for every language.
- Label it "Indonesia" in the picker. That's shorter but not the language's usual own name, so it's the least preferred.

**Test gap:** the e2e phone layout check runs on a Pixel 7 (412 px wide), so 320 px isn't covered. A check that every language fits at 320 px (no horizontal scroll) would catch this kind of problem.
