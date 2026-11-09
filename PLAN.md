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
| Offline | PWA service worker | Lets users install the app and use it offline; on GitHub Pages it also adds the isolation headers the host can't send |

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
- **Auto-save:** the original image, the mask and the history are saved to IndexedDB, so a refresh or a closed tab doesn't lose work. Opening a new image replaces the saved session. If saving fails (storage full or blocked), editing carries on, but a message says the work can't be saved and to download the image before leaving. It shows once, and again only if saving fails after it had worked.
- The mask is applied **only at export**, at full resolution. The large-image process works the same way: models run on a downscaled copy (about 1024 px long side), and the resulting selection is upscaled and edge-refined against the full-resolution original with a guided filter.

```
Original image (never changed)
        │
Tool (Auto | Select | Magic Wand | Color | Lasso | Brush | Shape) ──► selection S + Keep/Remove
        │
Hidden mask  ◄── undo/redo diffs, auto-saved
        │
Compositor (screen)        Export (PNG / WebP / JPG)
```

## 4. Background removal tools

The tools appear as one row: the four main ones (Auto, Select, Magic Wand, Color), then, after a divider, the manual ones (Lasso, Brush, Shape). One is always selected, and there is no separate "apply" step. Every tool shares one **Keep / Remove** toggle, and each tool remembers its own default mode.

### A. Auto (default)
- A model removes the background as soon as the image opens. This covers most cases (people, products, pets).
- Models, chosen per device:
  - **BiRefNet-lite** (MIT, 115 MB at fp16): best edges. Used only on WebGPU with half precision and a GPU allowing at least 17 storage buffers per shader. Many integrated GPUs allow 16, and BiRefNet fails on them.
  - **IS-Net** (DIS general-use; MIT-tagged ONNX of Apache-2.0 weights; 88 MB at fp16, 176 MB at fp32): used everywhere else, including the no-WebGPU fallback.
  - If BiRefNet still fails at run time, the app switches to IS-Net on the spot, and remembers that for later visits. If a model then fails on the GPU, it switches to the CPU the same way (see §7).
- The first run asks first: the button reads "Remove background (88 MB one-time download)", and tapping it opens the app's own "Download the AI model?" dialog with the size, a note that images are never uploaded, and **Not now** / **Download**. Select asks the same way on its first tap. Nothing is downloaded until Download; a cancelled download is asked about again. After that, Auto runs on its own whenever an image opens with Auto selected. A restored session never re-runs it over the user's work.
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
- Default mode is **Keep**. On an untouched image, the selection hides everything outside it. Once anything is hidden, Keep only brings areas back, so it can restore what another tool removed by mistake. In Remove mode, a tap or loop hides that object instead.

### C. Magic Wand
- Tap a pixel to select the **connected region** of similar colour, using a flood fill like Photoshop's Magic Wand.
- One slider controls **tolerance**. Colours are compared in **CIELAB** space (ΔE), which matches human perception better than RGB.
- Default mode is **Remove**: tap the background to hide it. Tapping in Keep mode brings an area back.
- Soft edges: alpha falls off across the last few ΔE of the tolerance band, so edges don't look jagged.
- Changing the slider right after a tap re-runs that tap live and replaces the last step rather than adding a new one. This makes it easy to dial the tolerance in.
- With a mouse or pen, resting the pointer on the image previews the tap before it happens (Magic Wand and Color): the result is shown as it would be, with the area that would change tinted red (Remove) or green (Keep). Moving away or applying clears it. Touch screens have no hover; there, Undo and the live slider re-tune serve the same purpose.

### D. Color
- Tap a colour to remove **every matching pixel in the whole image**, connected or not. This handles green screens, a sky seen through gaps, or a solid studio backdrop.
- One tolerance slider, using the same CIELAB matching as the Magic Wand.
- **Edge colour cleanup** (always on, no button) removes the coloured fringe a backdrop leaves on soft edges. Each partly visible edge pixel is un-mixed from the average colour of the removed pixels next to it. Because nothing is ever deleted, that background colour is always known. It works for every tool, not just Color, and applies only to the exported pixels, never the original.
- Default mode is **Remove**.

### Lasso (manual, no AI)
- Two kinds, switched with a Magnetic | Polygon toggle next to Keep / Remove (or Shift+L), and remembered.
- **Magnetic**, like Photoshop's magnetic lasso: drag roughly along an object's edge and the line snaps to it. Letting go closes the loop back to the start (along edges too, unless the gap is very long) and applies it with the shared Keep / Remove toggle. It works the same with a finger or a mouse, and Esc throws the line away.
- The path finding is "intelligent scissors": the cheapest 8-connected path between two pixels, where each step costs less the stronger the Sobel edge under it. Each search is limited to the box around its two ends plus the lasso's width (10 screen px), so it stays a few milliseconds and runs once per frame while dragging.
- The pointer only has to be near the edge: each position snaps to the strongest edge within the width. Once the live segment is 30 screen px long, it is fixed and a new one starts from its end.
- **Polygon**, like Photoshop's polygonal lasso: tap corner by corner, with straight sides between them. A press adds its corner where it is let go, so dragging first fine-tunes where (handy under a finger). With a mouse or pen, the next side follows the pointer before you click. Tapping the first corner again (within 10 screen px; its marker fills in when in reach), double-clicking, or Enter closes the outline and applies it. Shift keeps the side at 45° steps, Backspace takes back the last corner, and Esc throws the outline away. The outline survives zooming and panning (wheel, pinch, space-drag) between taps, so long outlines can be drawn zoomed in; picking another tool or lasso kind throws it away. Corners may lie outside the image, to run a side along the image's edge.
- The filled outline's rim is snapped to the image (3 px), like Select. Only the anti-aliased rim moves, so a polygon's sides stay where they were drawn but settle onto an edge they run along. Default mode is **Keep**, and it follows Select's rule: on an untouched image Keep cuts the object out; after that it only brings areas back.

### AI marking and data use
- Auto and Select carry a small "AI" badge (translated: IA, KI, …), and their tooltips say they use a model downloaded once to the device.
- Every model download shows **Cancel** next to its progress bar. Cancelling shuts the AI worker down, which ends the download; nothing half-downloaded is kept, and a fresh worker starts the next time an AI tool is used.

### Brush (touch-up, always available)
- A small brush icon sits next to the tool row, with a size slider and a hardness slider (Shift+[ / ]). It uses the shared Keep / Remove toggle.
- It covers the last few percent of errors after any tool.
- Hardness sets how much of the brush paints at full strength before fading (default 60%). At 50% and above, a stroke's rim snaps to the image's edges when you let go; softer brushes paint a plain fade, since they are for blending across edges. Every brush keeps a small solid core so the stroke's path is always fully painted.
- **Edge-aware:** when a stroke ends, its soft rim snaps to the real edge in the image. Each rim pixel is compared with the average colour just inside the stroke and just outside it. Where those differ, the rim follows the image edge; on flat areas the stroke stays exactly as painted. (A guided filter was tried first, but it blurred strokes on flat areas.)

- **Hair** (a Paint | Hair switch next to the brush size; no Keep / Remove, no hardness): for hair and fur. Nothing changes while painting, only a see-through band shows where; on release the edge under the stroke is worked out from the image. Each pixel's colour is treated as a mix of the subject colour F and the background colour B: F is the average of the certainly kept pixels nearby and B of the certainly removed ones, both sampled outside the stroke (the stroke marks where the mask is unsure), within twice the brush radius so both sides are in reach from anywhere in the stroke. α is where the pixel falls on the line from B to F. The averages are gathered on a grid about 1/12 of that reach and interpolated, so wide strokes on large photos stay quick and small. Where F and B look alike the mask is left as it was.
  - On a 4000×3000 test photo with 900 fine strands cut off by a hard outline, one refine stroke took the error on hair pixels from 0.90 to 0.03 (sky stayed at 0.003), in about 0.3 s.

### Edges (whole image)
- An **Edges** button next to Undo opens a small panel with three sliders, all starting at zero:
  - **Edge position**: shrink ↔ grow, up to 8 px. Grey dilation / erosion alternating 3×3 square and plus steps, so the shape grows nearly round and soft edges keep their profile.
  - **Edge softness**: crisp ↔ soft. Soft blurs the mask (two box blurs); crisp steepens the fade around its middle.
  - **Clean up specks**: removes small islands and fills small holes (not touching the border), with their soft rims, up to 0.4% of the image at full strength. Islands connect diagonally, holes only through edges.
- Each opening of the panel is one undo step: every slider move re-runs all three on the mask as it was when the panel opened and replaces that step, so settings never compound. Anything else changing the history (Undo, another tool) closes the panel.
- The work runs in the image worker, and moves made while it's busy are coalesced. Only 64 px tiles near an edge are processed (flat tiles surrounded by the same value can't change), and specks are found once per panel session by labelling runs of pixels, then cached. On a 12 MP hair-heavy test image a change takes 0.1–0.7 s.

### Shape (boxes and ellipses)
- Drag to draw a box or ellipse (picked with a Box | Ellipse switch); it is applied when you let go, with the shared Keep / Remove toggle (Remove by default). Shift makes a square or circle. Edges are anti-aliased but not snapped, so the shape is exactly what you drew.

## 5. UI layout

```
┌───────────────────────────────────────────────┐
│ BackSubtract              🌐 English ▾  ♥ Donate│  ← top bar
├───────────────────────────────────────────────┤
│                    Result|Overlay|Original  ▦ │  ← view switch, background
│            [ canvas / drop zone ]             │
│                                               │
├───────────────────────────────────────────────┤
│ Auto Select Wand Color │ Lasso Brush Shape    │  ← tools
│ [Keep|Remove]  (the tool’s sliders, switches) │  ← context row
│ Open  Edges  ↶ ↷                [ Download ▾ ]│  ← actions
└───────────────────────────────────────────────┘
```

- **Empty state:** the whole canvas is a drop zone, with paste (Ctrl+V) and a single "Choose image" button. On mobile, the button also offers the camera.
- **After opening an image**, the bottom bar appears. The context row shows only what the selected tool needs: for Auto, its Remove background / Run again button; for the others, the Keep/Remove toggle, plus the tool's slider (tolerance, or brush size and hardness) and its switch (Magnetic | Polygon, Paint | Hair, Box | Ellipse). Hair needs neither Keep/Remove nor hardness, so it hides them. The actions row holds Open another image, Edges, Undo / Redo and Download.
- **Download** is one button. Its small ▾ chooses the format (remembered between visits):
  - **PNG** (default; keeps transparency)
  - **WebP** (keeps transparency, smaller)
  - **JPG** (no transparency, opens everywhere)
  - **Mask**: the hidden mask itself as a black-and-white PNG, for finishing in another editor
  - **Background**, for every format but Mask, remembered between visits: **None** (transparent; not offered for JPG, which gets the colour instead), **Colour** (white, black or any colour; white covers e-commerce photos), **Blur** and **Image**.
    - **Blur** is the photo's own background, blurred like a phone's portrait mode, with a strength slider (a radius of up to 5% of the photo's longer side). Blurring the whole photo would smear the subject's colours into a halo, so only removed pixels feed it: it is weighted by the mask (blur of image × removed, divided by blur of removed). Soft edge pixels (mask 32 and above) hold some of the subject and are left out. Where the blur finds no background, such as behind a large subject, the colour fills in from the background around it through a pyramid of coarser levels ("push-pull"). This works because nothing is ever deleted. A blur has no fine detail, so it runs on cells of about 1/8 of the radius and is scaled up, which keeps it quick on large photos. If nothing has been removed, the whole photo is blurred.
    - **Image** is a photo picked from the device, scaled to cover the frame and centred. It is kept in IndexedDB under its own key, so it stays when another image is opened and is there next visit.
    - Edge colour cleanup runs first, so soft edges lose the old backdrop's fringe before they meet the new background.
    - While the menu is open, the canvas shows the download as it will be: the chosen background in place of the checkerboard, and with Trim, the frame (reaching past the image's edges where it does). Removed areas are not ghosted meanwhile. Closing the menu brings the checkerboard back, since it is better for spotting missed bits. The four choices may wrap onto two lines in languages with long words.
  - **Trim to subject** (crop to the visible area's bounding box) as a checkbox in the same menu, with a **margin** slider (0–30% of the subject's longer side) and a **shape**: Fit, 1:1, 4:5 or 16:9. The frame grows around the subject and may reach past the image's edges; that part is transparent, or gets the background (Blur extends its edge pixels outward).
  - **Full size**: a photo scaled down to 4096 px on opening still exports at its original size. The original file is decoded again in the image worker, the mask is scaled up, and its hard edges snap to the full-size photo (soft brush edges are wider than the snap radius and stay soft). If the browser can't hold the full size (e.g. iOS canvas limits), the export falls back to the edited size. A checkbox turns this off.
  - **Copy** (PNG to the clipboard, with the chosen background) and **Share** (the system share sheet, where it takes files) sit at the bottom of the menu.
- **Gestures:** pinch or wheel to zoom, two-finger drag or space-drag to pan, and press-and-hold to compare with the original. None of these needs a button.
- **Edges** sits with the actions (next to Undo): see section 4.
- **Background**: a small checkerboard button beside the Result / Overlay / Original switch opens two settings for spotting missed bits, both remembered. **Contrast** runs from one even colour, through the theme's own subtle checkerboard (the default), to black and white. **Move the background** slides the checkerboard slowly (24 px/s), so leftover opaque bits stand still against the motion. It slides rather than flashes, to stay comfortable for people sensitive to flicker, and only redraws while it is on.
- **Keyboard:** 1–4 pick tools, L the lasso (Shift+L switches Magnetic / Polygon), B the brush, M the shape, X toggles Keep/Remove, [ and ] change size or tolerance, and Ctrl+Z / Ctrl+Shift+Z undo and redo. The README lists every shortcut.
- Dropping another file anywhere (or pasting one, or choosing one) starts a new session with it. If the current image has edits, the app's own dialog asks first ("Open a new image?", with **Open new image** focused so Enter accepts). It is not window.confirm, which some browsers and embedded views suppress, leaving a drop doing nothing.
- **Donate:** a small, quiet ♥ in the top bar. See section 10.

## 6. Internationalisation

- The language dropdown in the top bar is the only global setting.
- The initial language comes from `navigator.languages`, and the user's choice is saved in `localStorage`.
- Strings live in `src/locales/<code>.json` and load through react-i18next. Each language loads only when chosen. Few strings are needed, since the UI is mostly icons with tooltips and accessible labels.
- **RTL support:** the app sets `dir="rtl"` for Arabic and Hebrew and uses CSS logical properties throughout.
- Launch set (suggested): en, es, fr, de, pt, zh-CN, ja, ar, hi.
- Added since: ru, id, ko, bn, zh-TW, he (15 in all). Hebrew is also picked for the old code `iw`, and Indonesian for `in`, which some older Android and Java-based browsers still report. Chinese is picked by script: Traditional for zh-Hant, Taiwan, Hong Kong and Macau, Simplified otherwise. The picker lists each in its own language, next to related ones. A browser test opens an image on a 375 px and a 320 px phone in every language, in the platform's own font and again in a wide one (Verdana, or DejaVu Sans on Linux, where CI runs), and checks nothing goes off screen, no tool label spills over, and nothing sticks out of the Download menu. On phones tool buttons are at least as wide as their longest word and share the rest equally. Where a row is still too tight, text shortens with an ellipsis rather than overflowing: a long Download label, the language picker, and the view switch's labels. At 360 px and below, the view switch also uses tighter padding and smaller text.

## 7. Performance and compatibility

- Detect **WebGPU**, and fall back to WASM with SIMD and threads. ONNX Runtime's WASM uses shared memory (`SharedArrayBuffer`), which needs a cross-origin isolated page: without it, Firefox won't run it at all and other browsers run it on one thread instead of several. `public/_headers` sets COOP `same-origin` and COEP `credentialless` on Netlify and Cloudflare Pages. GitHub Pages can't set headers, so there the app's own service worker adds them (`public/sw-isolation.js`) instead of the `coi-serviceworker` shim. Safari doesn't support `credentialless`, so it isn't isolated on any host.
- **WebGPU that fails falls back to the CPU.** Firefox and Safari now offer WebGPU too, but ONNX Runtime's WebGPU support is tested mostly in Chrome, and a model can fail there in ways that can't be checked up front, such as a device that can't be created or a shader the browser rejects. When Auto or Select fails on the GPU (or BiRefNet fails), the app restarts the AI worker and tries again without it, because ONNX Runtime can be left unusable after a GPU failure. It remembers the fallback for later visits (`backsubtract.gpuFallback` and `backsubtract.autoFallback` in localStorage), but only once the retry works, so an offline attempt never counts against the device. Falling back can mean a second download (Auto: IS-Net at fp32, 176 MB).
- **Lazy-load** each model the first time its tool is used, with a progress bar, e.g. "Downloading AI model… 34 / 88 MB (one time)". Models stay in the browser's Cache API. Agreeing to a download also asks the browser to keep the site's data (`navigator.storage.persist()`), so the models and the saved session aren't cleared when the device runs low on space. Chrome and Safari decide by themselves; Firefox asks the user, which is why it's asked only at that moment.
- Prefer **half-precision or quantised models**. Quality background models are about 90–115 MB, more than the original 50 MB target, so Auto asks before its first download.
- The ONNX Runtime WASM file is about 27 MB. Transformers.js loads it from jsDelivr (about 4.7 MB compressed) and caches it, so it isn't part of the site: `vite.config.ts` keeps Vite from copying in onnxruntime-web's unused local fallback. The build is about 1 MB, and any static host works, Cloudflare Pages (25 MiB per-file limit) included. Earlier versions also kept a second copy in an `ai-runtime` service worker cache; `public/sw-cleanup.js` deletes it.
- Images are decoded with `createImageBitmap`, and EXIF orientation is honoured.
- HEIC (iPhone) photos open where the browser can decode them, as Safari does. Elsewhere a clear message explains how to get a JPG. `heic2any` was not added: it bundles libheif, which is LGPL-3.0, and that would need a licensing decision first.
- Memory: cap the working resolution at about 4096 px on the long side and warn above that. Undo history gets a budget that fits beside the photo: 32 MB per GB of reported device memory (Chromium's `navigator.deviceMemory`), between 48 and 256 MB; 96 MB on iPhone and iPad, which report nothing and whose Safari closes tabs that use too much; 256 MB elsewhere. Whole-image steps (Auto, Edges) store only the area that changed.

## 8. Project structure

```
src/
  app/            App shell, TopBar, BottomBar, Download menu, dialogs, toasts, shortcuts
  state/          Zustand store (tool, modes, slider values, remembered settings, notices)
  editor/         The open image, its mask and undo history; history memory budget
  canvas/         Viewer (zoom/pan, gestures), WebGL compositor, checkerboard,
                  the download's background and frame shown while its menu is open
  ml/             AI worker (Transformers.js: Auto and Select models), its client,
                  download status, and the e2e stand-in worker
  cv/             Image worker: Magic Wand, Color, Edges and export encoding
  tools/
    controller.ts Starts AI work at the right moments (Auto on open, Select's encoding)
    cutout.ts     Applies an outline the way Select and Lasso do
    auto/         Auto: runs the background model
    select/       Select: tap prompts, and loops turned into points
    color/        Lab colour distance, Magic Wand flood fill, global colour key, hover preview
    lasso/        Magnetic (intelligent scissors) and Polygon lasso
    brush/        stroke rasterising, edge snapping, Hair refine
    shape/        boxes and ellipses
    edges/        Edges panel: live re-runs, one undo step per opening
  mask/           Mask model, Keep/Remove combine, undo diffs, filters, resampling,
                  edge snapping, whole-mask edge adjustments
  session/        Opening images, IndexedDB auto-save / restore
  export/         PNG/WebP/JPG encoders, trim, backgrounds (colour, blur, image), edge colour cleanup
  i18n/           react-i18next setup, locale detection, RTL
  locales/        *.json
public/           icons, _headers, service worker add-ons (isolation, cleanup)
e2e/              Playwright browser tests
golden/           golden-image tests
scripts/          icon and golden-image generators
```

## 9. Milestones

1. ✅ **Skeleton (week 1):** Vite + React app, open/drop/paste image, WebGL viewer with zoom/pan, the non-destructive mask model with undo/redo, PNG export, and an i18n scaffold with 2 languages.
2. ✅ **Classic tools (week 2):** Magic Wand, Color, edge-snapping brush, edge colour cleanup, ghost preview, IndexedDB auto-save, and PNG/WebP/JPG export with trim.
   - Measured on a 12.6 MP photo: a tap takes about 0.2–0.3 s, a slider re-tune 0.1–0.2 s, and an export 1.1–1.4 s (mostly encoding).
   - ✅ Follow-up done: wand/colour taps, re-tunes and export encoding run in an image worker. Pixels are shared via SharedArrayBuffer when cross-origin isolated, and copied otherwise. The main thread blocks for at most a few ms.
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
   - ✅ Vitest unit tests for the mask maths: Keep/Remove combine, recovery after removal, undo diffs, flood fill, colour key, export.
   - ✅ Playwright smoke tests (`npm run test:e2e`) on Desktop Chrome and a Pixel 7 profile, using real touch taps on the phone. They run in the GitHub Pages workflow on every push, and the site is only deployed if they pass. The same tests also run there in Firefox and WebKit, without holding up the deploy until their failures are sorted out. They cover the start screen, language and RTL, About, opening an image, Magic Wand, Color with Keep/Remove, brush, undo/redo, restoring after a reload, the message when saving fails, and the download backgrounds (Colour and its canvas preview, Blur with no halo of the subject's colour, Image with Trim and after a reload, and JPG without None). Each checks the downloaded PNG's actual transparency. The AI tools are covered too, against a stand-in AI worker swapped in by the `e2e` build mode: it speaks the same protocol, simulates downloads (with progress, caching and cancelling) and returns colour-based masks. The tests cover the download dialog (Download, and Not now for Auto and Select), progress and Cancel, Auto running by itself once downloaded, a restored session not being overwritten, a failing model's message, and Select taps and loops. Each was checked to fail when the behaviour it guards is broken. The real models are still only tried by hand.
   - ✅ Golden images (`golden/*.png`): Magic Wand, Color on a green screen, and an edge-snapping brush stroke, each run on fixed photo-like scenes. They're compared on every `npm test` and are viewable as a visual record; regenerate with `npm run golden:update`. They exposed a green fringe left by colour selections, now fixed by anti-aliasing colour selections against the image.
6. **Next features:**
   - ✅ Background options for every format: None, Colour, Blur and Image, previewed on the canvas while the Download menu is open (section 5).
   - Planned, not started: a touch loupe and Batch Auto (section 13).

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
| MODNet (portrait option) | Apache-2.0 | ✅ Allowed; not added |
| SlimSAM-77 (Select) | Apache-2.0 | ✅ Use |
| Transformers.js, ONNX Runtime Web | Apache-2.0 / MIT | ✅ Use |
| React, Zustand, react-i18next, Vite | MIT | ✅ Use |
| heic2any | MIT, but bundles libheif (LGPL-3.0) | ⏸ Not added: needs a licensing decision first (section 7) |
| RMBG-1.4 / 2.0 (BRIA) | Non-commercial (CC BY-NC / BRIA licence) | ❌ Excluded |
| @imgly/background-removal | AGPL-3.0 | ❌ Excluded (copyleft; conflicts with Apache-2.0) |

Rules going forward:
- Before adding any model or library, check its licence **and the licence of the model weights**. Weights are sometimes licensed differently from the code, and some are trained on datasets with their own restrictions.
- List every model and dependency with its licence in a `THIRD_PARTY_LICENSES.md` file, linked from the About / Support page.

## 12. Decisions log

- **Framework:** React 19 + Vite + TypeScript.
- **Tools:** Auto, Select (tap + draw-around merged), Magic Wand, Color, plus the brush. Later added: Lasso (Magnetic and Polygon), Shape, the brush's Hair mode, and the Edges panel.
- **Editing:** non-destructive hidden mask. Everything is recoverable and the user never manages a mask directly.
- **Licensing:** permissive licences only (MIT / Apache-2.0 / BSD).
- **Donations:** custom in-app donate dialog with Stripe Payment Links behind it, and no backend at launch.

## 13. Planned features

Not started. Each keeps to section 1: no new buttons on the main screen, nothing destroyed, nothing uploaded.

### Touch loupe
- A finger hides the exact spot it is working on. While one finger is down with the brush, either lasso, the shape tool or a Select loop, a round magnifier (about 120 px) appears above the finger. It shows the image and its removed areas at twice the current zoom, with the brush ring, the lasso line or the shape's corner, and a small crosshair at the touch point.
- It sits up and to the side of the finger, and moves to the other side near the top or a side of the screen. It goes away when the finger lifts, and while two fingers pinch or pan.
- Only for touch. A mouse or pen doesn't hide the spot, so they never see it. There is no setting.
- The WebGL compositor draws it as a second, scissored viewport on the same canvas, so it costs no extra copy of the image.

### Batch Auto
- Choosing, dropping or pasting several images at once opens a **batch** instead of one image. A single image works as it does today.
- The batch shows a grid of thumbnails. Auto runs on each in turn, in the one AI worker, and each thumbnail shows its result, or that it is waiting or running. The first run asks about the model download, as Auto always does.
- Tapping a thumbnail opens that image in the normal editor, to fix it with any tool. A **Back to batch** button returns to the grid with the fix kept.
- **Download all** saves a zip using the current Download settings (format, background, trim, full size). The zip is store-only (PNG, WebP and JPG are already compressed), written by a few lines of our own code with CRC-32, so it needs no new dependency. Where the system share sheet takes several files (mostly phones), **Share** sends them without a zip.
- Memory: only thumbnails stay in memory. Each image's original file and mask live in IndexedDB, and an image is loaded fully only while it runs or is open. The batch is saved like a single session, so a refresh doesn't lose it. A batch holds up to 50 images; beyond that, a message says the rest were left out.
