# BackSubtract — Implementation Plan

## 1. Product principles

- **One workflow, three steps:** Open image → Remove background → Download.
- **Few buttons.** Each screen shows only what the current step needs.
- **Nothing is ever destroyed.** Removed areas are hidden, not deleted, and can always be brought back. Users never see or think about a "mask".
- **Private by default.** All processing happens in the browser. Images never leave the device, so the site needs no server, no accounts, and no uploads.
- **Works with a mouse or a finger.** Every interaction uses Pointer Events. Nothing depends on hover or right-click.

## 2. Architecture

| Concern | Choice | Why |
|---|---|---|
| Build | **Vite + TypeScript** | Fast, static output, no backend |
| UI | **React 19** | Familiar to most contributors, large ecosystem |
| App state | **Zustand** | Tiny; easy to share state between React and the canvas/workers |
| Canvas rendering | **WebGL2** compositor | Redraws image + mask each frame, so edits on large images stay smooth |
| ML runtime | **Transformers.js / ONNX Runtime Web** in a Web Worker | Runs on WebGPU and falls back to WASM; models load from the Hugging Face CDN |
| Heavy work | **Web Workers** | Keeps the UI responsive during inference |
| Model caching | **Cache API** | Each model downloads once, then works offline |
| Session saving | **IndexedDB** | Work in progress survives a page refresh (stored on the device only) |
| i18n | **react-i18next** | Standard, handles plurals and lazy-loaded languages |
| Hosting | Any static host (GitHub Pages, Cloudflare Pages, Netlify) | Free, with no server to maintain |
| Offline | PWA service worker (optional, phase 4) | Lets users install the app |

## 3. Non-destructive editing

This works like a layer mask in Photoshop, but the user never sees it as one.

- **The original image is never modified.** It's kept in memory (and in IndexedDB) exactly as it was opened.
- **Visibility lives in a hidden mask:** a single-channel Uint8 array at full resolution, where 255 means visible, 0 means removed and values in between are soft edges.
- **Every tool only changes the mask.** Each action produces a selection `S` (0–255) and a mode:
  - **Remove:** `mask = min(mask, 255 − S)`
  - **Keep:** `mask = max(mask, S)`

  Because of this, any area removed by one tool can be brought back by any other tool in Keep mode: a Magic Wand tap, a Select tap, or the brush.
- **Tools stack.** Switching tools never resets the work done so far. For example, a user might run Auto, then remove a stray patch with Magic Wand, then brush back a lost hand.
- **Removed areas stay recoverable on screen.** When the brush or a tool is in Keep mode, removed areas show as a faint ghost (about 15% opacity) so users can see what they can restore. Otherwise removed areas show the transparency checkerboard. Press-and-hold anywhere shows the full original.
- **Undo/redo** stores only the changed rectangle of the mask for each action, so a long history stays cheap even on large photos.
- **Auto-save:** the original image, the mask and the history are saved to IndexedDB, so a refresh or a closed tab doesn't lose work. Opening a new image replaces the saved session.
- The mask is applied **only at export**, at full resolution. The large-image process works the same way: models run on a downscaled copy (about 1024 px long side), and the resulting selection is upscaled and edge-refined against the full-resolution original with a guided filter.

```
Original image (never changed)
        │
Tool (Auto | Select | Magic Wand | Color | Brush) ──► selection S + Keep/Remove
        │
Hidden mask  ◄── undo/redo diffs, auto-saved
        │
Compositor (screen)        Export (PNG / WebP / JPG)
```

## 4. Background removal tools (4 + brush)

The tools appear as one row of four large icons. One is always selected, and there is no separate "apply" step. Every tool shares one **Keep / Remove** toggle, and each tool remembers its own default mode.

### A. Auto (default)
- A model removes the background as soon as the image opens. This covers most cases (people, products, pets).
- Models, chosen per device:
  - **BiRefNet-lite** (MIT, 115 MB at fp16): best edges. Used only on WebGPU with half precision and a GPU allowing at least 17 storage buffers per shader. Many integrated GPUs allow 16, and BiRefNet fails on them.
  - **IS-Net** (DIS general-use; MIT-tagged ONNX of Apache-2.0 weights; 88 MB at fp16, 176 MB at fp32): used everywhere else, including the no-WebGPU fallback.
  - If BiRefNet still fails at run time, the worker switches to IS-Net on the spot, and the app remembers that for later visits.
- The first run asks first: the button reads "Remove background (88 MB one-time download)". After that, Auto runs on its own whenever an image opens with Auto selected. A restored session never re-runs it over the user's work.
- Tapping Auto again re-runs it, which resets the mask to the model's result as an undoable step.

### B. Select (Segment Anything): tap or draw around
This tool merges the earlier "Tap object" and "Draw around" ideas into one button.
- Model: **SlimSAM-77** (Apache-2.0, about 17 MB) through Transformers.js. The image encoder runs on WebGPU and the small prompt decoder on WASM.
- The image is encoded **once** in a worker, taking about 1–3 s on WebGPU. Each prompt then runs only the small decoder, in about 50 ms.
- **Tap** an object to select it. Each additional tap refines the selection.
- **Drag a loop** around an object. The SlimSAM ONNX export takes points only, not boxes, so the loop is turned into points:
  - a few candidate points deep inside the loop, each tried on its own;
  - background points just outside the loop's bounding box, used with every candidate.

  Each of SAM's proposals is scored by how much of the loop it fills, minus how far it spills outside. The best one is clipped to the loop, with a little slack.
- If no proposal fits, for example a loop around plain background, the loop itself is used, and its edge snaps to the image. This replaces the planned OpenCV GrabCut fallback and saves an 8 MB download.
- Masks come back at about 1024 px. They're upscaled, and their edge snaps to the full-resolution image using the brush's edge snapping, in tiles.
- Default mode is **Keep**. The first selection hides everything outside it, and later selections add to it. In Remove mode, a tap or loop hides that object instead.

### C. Magic Wand
- Tap a pixel to select the **connected region** of similar colour, using a flood fill like Photoshop's Magic Wand.
- One slider controls **tolerance**. Colours are compared in **CIELAB** space (ΔE), which matches human perception better than RGB.
- Default mode is **Remove**: tap the background to hide it. Tapping in Keep mode brings an area back.
- Soft edges: alpha falls off across the last few ΔE of the tolerance band, so edges don't look jagged.
- Changing the slider right after a tap re-runs that tap live and replaces the last step rather than adding a new one. This makes it easy to dial the tolerance in.

### D. Color
- Tap a colour to remove **every matching pixel in the whole image**, connected or not. This handles green screens, a sky seen through gaps, or a solid studio backdrop.
- One tolerance slider, using the same CIELAB matching as the Magic Wand.
- **Edge colour cleanup** (always on, no button) removes the coloured fringe a backdrop leaves on soft edges. Each partly visible edge pixel is un-mixed from the average colour of the removed pixels next to it. Because nothing is ever deleted, that background colour is always known. It works for every tool, not just Color, and applies only to the exported pixels, never the original.
- Default mode is **Remove**.

### Brush (touch-up, always available)
- A small brush icon sits next to the tool row, with one size slider. It uses the shared Keep / Remove toggle.
- It covers the last few percent of errors after any tool.
- **Edge-aware:** when a stroke ends, its soft rim snaps to the real edge in the image. Each rim pixel is compared with the average colour just inside the stroke and just outside it. Where those differ, the rim follows the image edge; on flat areas the stroke stays exactly as painted. (A guided filter was tried first, but it blurred strokes on flat areas.)

## 5. UI layout

```
┌───────────────────────────────────────────────┐
│ BackSubtract              ♥ Donate  🌐 English ▾│  ← top bar
├───────────────────────────────────────────────┤
│                                               │
│            [ canvas / drop zone ]             │
│                                               │
├───────────────────────────────────────────────┤
│  ✨Auto   👆Select   🪄Wand   🎨Color   │ 🖌      │  ← tools + brush
│  [Keep|Remove]   (one slider: tolerance/size) │  ← context row
│  ↶ ↷                            [ Download ▾ ]│
└───────────────────────────────────────────────┘
```

- **Empty state:** the whole canvas is a drop zone, with paste (Ctrl+V) and a single "Choose image" button. On mobile, the button also offers the camera.
- **After opening an image**, the bottom bar appears. The context row holds the Keep/Remove toggle plus *at most one* slider.
- **Download** is one button. Its small ▾ chooses the format (remembered between visits):
  - **PNG** (default, transparent)
  - **WebP** (transparent, smaller)
  - **JPG** with a background colour picker (the white default covers e-commerce photos)
  - **Trim to subject** (crop to the visible area's bounding box) as a checkbox in the same menu
- **Gestures:** pinch or wheel to zoom, two-finger drag or space-drag to pan, and press-and-hold to compare with the original. None of these needs a button.
- **Keyboard:** 1–4 pick tools, B picks the brush, X toggles Keep/Remove, [ and ] change size or tolerance, and Ctrl+Z / Ctrl+Shift+Z undo and redo.
- Dropping another file anywhere starts a new image after a quick "Replace current image?" confirmation.
- **Donate:** a small, quiet ♥ in the top bar. See section 10.

## 6. Internationalisation

- The language dropdown in the top bar is the only global setting.
- The initial language comes from `navigator.languages`, and the user's choice is saved in `localStorage`.
- Strings live in `src/locales/<code>.json` and load through react-i18next. Each language loads only when chosen. Few strings are needed, since the UI is mostly icons with tooltips and accessible labels.
- **RTL support:** the app sets `dir="rtl"` for Arabic and Hebrew and uses CSS logical properties throughout.
- Launch set (suggested): en, es, fr, de, pt, zh-CN, ja, ar, hi.

## 7. Performance and compatibility

- Detect **WebGPU**, and fall back to WASM with SIMD and threads. That fallback needs COOP/COEP headers for `SharedArrayBuffer`; set them on the host. GitHub Pages can't set headers, so either use Cloudflare Pages or Netlify, or use the `coi-serviceworker` shim.
- **Lazy-load** each model the first time its tool is used, with a progress bar, e.g. "Downloading AI model… 34 / 88 MB (one time)". Models stay in the browser's Cache API.
- Prefer **half-precision or quantised models**. Quality background models are about 90–115 MB, more than the original 50 MB target, so Auto asks before its first download.
- The ONNX Runtime WASM file is about 27 MB and ships with the site. That's over Cloudflare Pages' 25 MiB per-file limit, so either host on Netlify or GitHub Pages, or load it from a CDN.
- Images are decoded with `createImageBitmap`, and EXIF orientation is honoured. HEIC (iPhone) is supported through a lazy-loaded `heic2any`.
- Memory: cap the working resolution at about 4096 px on the long side and warn above that.

## 8. Project structure

```
src/
  app/            App shell, TopBar, BottomBar, DownloadMenu, DonateDialog
  state/          Zustand stores (tool, mode, slider values, session)
  canvas/         Viewer (zoom/pan), WebGL compositor, pointer/gesture handling
  tools/
    auto/         worker + model wrapper
    select/       SAM worker (encoder/decoder), tap + loop prompts, GrabCut fallback
    wand/         contiguous Lab flood fill
    color/        Lab colour distance, wand flood fill, global colour key, tap + re-tune
    brush/        stroke rasterising + edge-aware refine
  mask/           Mask model, Keep/Remove combine, undo diffs, box filter
  session/        IndexedDB auto-save / restore
  export/         PNG/WebP/JPG encoders, trim, edge colour cleanup
  i18n/           react-i18next setup, locale detection, RTL
  locales/        *.json
public/           icons, manifest
```

## 9. Milestones

1. ✅ **Skeleton (week 1):** Vite + React app, open/drop/paste image, WebGL viewer with zoom/pan, the non-destructive mask model with undo/redo, PNG export, and an i18n scaffold with 2 languages.
2. ✅ **Classic tools (week 2):** Magic Wand, Color, edge-snapping brush, edge colour cleanup, ghost preview, IndexedDB auto-save, and PNG/WebP/JPG export with trim.
   - Measured on a 12.6 MP photo: a tap takes about 0.2–0.3 s, a slider re-tune 0.1–0.2 s, and an export 1.1–1.4 s (mostly encoding).
   - Follow-up: move tap and export work into a Web Worker so the page never pauses, alongside the ML workers in week 3.
3. ✅ **ML tools (week 3):** Auto (BiRefNet or IS-Net by device) and Select (SlimSAM taps and loops), both in a Web Worker. Includes WebGPU/WASM detection, model caching, and download/progress UI.
   - Measured on an Intel gen-9 GPU with a 1600×1200 image:
     - Auto: 88 MB download in about 4 s, then about 3 s per run (5 s for the first run after a reload).
     - Select: about 8.6 s for the first tap (17 MB download plus preparing the image), then about 0.5 s per tap and 0.4 s per loop.
4. ✅ **Donations and polish:**
   - Donate dialog (Stripe Payment Links via env vars, hidden until configured), with a thank-you message on return.
   - About dialog with privacy, shortcuts, credits and contact.
   - French, German, Portuguese, Chinese, Japanese, Arabic (RTL) and Hindi, plus a key/placeholder consistency test.
   - Touch polish.
   - Installable PWA that works offline (app shell precached; AI runtime and models cached on first use).
   - Deploy steps are in the README; the actual deploy is left to the owner.
   - Still open: native-speaker review of the translations, and testing on real phones and other GPUs.
5. **Testing throughout:**
   - Vitest unit tests for the mask maths: Keep/Remove combine, recovery after removal, undo diffs, flood fill, colour key, export.
   - Playwright smoke tests on desktop and mobile viewports.
   - A small set of golden images for a visual check of each tool.

## 10. Donations (custom, no third-party donation platform)

**Is a fully home-made payment system reasonable? No.** Accepting card details directly brings PCI-DSS compliance, fraud, chargebacks and security liability. That would be a big project in itself, and a risky one.

**What is reasonable** is making the donation experience your own while a payment processor moves the money behind the scenes. Visitors only ever see your page and your wording.

**Recommended approach: your own donate dialog + Stripe Payment Links**
- The ♥ Donate button opens **your own dialog** in the app. It has a short thank-you message, preset amounts (e.g. $3 / $5 / $10) and a "custom amount" option, all styled like the rest of the site and translated.
- Each choice opens a **Stripe Payment Link** configured as "customer chooses what to pay". Stripe hosts only the card-entry page, which can be branded with your logo and colours, and then returns to your own thank-you page.
- This needs **no server and no backend code**, which keeps the site fully static. Your site never touches card data.
- Stripe supports cards, Apple Pay, Google Pay and many local payment methods, and converts currency automatically.
- Fees are roughly 2.9% + 30¢ per donation in the US (varies by country).

**Possible later upgrade:** if you want monthly donations, a donor wall or custom receipts, add one small serverless function (Cloudflare Worker or Netlify Function) that creates Stripe Checkout sessions and receives webhooks. This is only worth doing if donations become meaningful.

**Alternatives to Stripe** (same design, different processor): PayPal donate buttons, Lemon Squeezy or Paddle. Paddle and Lemon Squeezy handle international sales tax for you as merchant of record, but charge higher fees.

**Things to check before launch** (not legal or tax advice; worth a quick check with an accountant):
- Donations to an individual are usually **taxable income** and **not tax-deductible** for donors unless you set up a registered non-profit. Wording should say "support" or "tip" rather than imply a charitable deduction.
- Stripe requires a short public page with contact info and a refund policy. A small "About / Support" page covers this.
- Keep the donate button low-key: nothing is gated, nagged or delayed, and every feature stays free.

## 11. Licensing

The site is free, with optional donations. Accepting donations can count as commercial use under non-commercial licences, so the project uses **only permissively licensed code and models**: MIT, Apache-2.0 or BSD. These are compatible with the repo's own Apache-2.0 licence.

| Component | Licence | Status |
|---|---|---|
| BiRefNet-lite (Auto, capable GPUs) | MIT | ✅ Use |
| IS-Net general-use (Auto, everywhere else) | Apache-2.0 weights (DIS); ONNX build tagged MIT | ✅ Use |
| MODNet (portrait option) | Apache-2.0 | ✅ Optional |
| SlimSAM-77 (Select) | Apache-2.0 | ✅ Use |
| Transformers.js, ONNX Runtime Web | Apache-2.0 / MIT | ✅ Use |
| React, Zustand, react-i18next, Vite | MIT | ✅ Use |
| heic2any | MIT | ✅ Use |
| RMBG-1.4 / 2.0 (BRIA) | Non-commercial (CC BY-NC / BRIA licence) | ❌ Excluded |
| @imgly/background-removal | AGPL-3.0 | ❌ Excluded (copyleft; conflicts with Apache-2.0) |

Rules going forward:
- Before adding any model or library, check its licence **and the licence of the model weights**. Weights are sometimes licensed differently from the code, and some are trained on datasets with their own restrictions.
- List every model and dependency with its licence in a `THIRD_PARTY_LICENSES.md` file, linked from the About / Support page.

## 12. Decisions log

- **Framework:** React 19 + Vite + TypeScript.
- **Tools:** Auto, Select (tap + draw-around merged), Magic Wand, Color, plus the brush.
- **Editing:** non-destructive hidden mask. Everything is recoverable and the user never manages a mask directly.
- **Licensing:** permissive licences only (MIT / Apache-2.0 / BSD).
- **Donations:** custom in-app donate dialog with Stripe Payment Links behind it, and no backend at launch.
