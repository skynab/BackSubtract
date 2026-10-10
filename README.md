# BackSubtract
A website dedicated to just providing a few quick ways to subtract a background from an image.

Everything runs in the browser — images never leave the device. See [PLAN.md](PLAN.md) for the full design.

## Development

Requires Node 20+.

```bash
npm install
npm run dev      # start the dev server at http://localhost:5173
npm test         # unit tests + golden-image comparisons
npm run golden:update  # regenerate golden/*.png after an intended change (look at them first!)
npm run test:e2e # browser tests (desktop + phone), against a fresh test build
npm run build    # type-check and build to dist/
```

The first time, install the browser for the e2e tests with `npx playwright install chromium`. The e2e tests build in `e2e` mode (into `dist-e2e/`, so `dist/` is never touched): the real app, except that the AI worker is a stand-in (`src/ml/fake-worker.ts`) that simulates the model downloads and returns simple colour-based results. That covers everything around the AI tools without downloading over 100 MB of models on every run; the real models still need trying by hand.

`npm run preview` serves the production build (with the offline service worker) at http://localhost:4173.

## Deploying

The site is static: deploy the `dist/` folder.

- **Headers.** The AI models' WASM fallback needs cross-origin isolation. `public/_headers` sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, and Netlify and Cloudflare Pages read that file. GitHub Pages can't set headers.
- **File size.** The ONNX Runtime WASM file is about 27 MB. That's over Cloudflare Pages' 25 MiB per-file limit, so Netlify (or another host without that limit) is the simplest choice.
- **Settings.** Copy `.env.example` to `.env.local`, or set the same variables in the host's build settings:
  - `VITE_DONATE_LINK_*`: Stripe Payment Links for the Donate dialog. The Donate button stays hidden until at least one is set (it always shows under `npm run dev`, so you can see it while working). Set each link's after-payment redirect to `https://<your-site>/?thanks` to show a thank-you message.
  - `VITE_CONTACT_EMAIL`: shown on the About page. Stripe requires public contact details, and a refund policy if you have one.
- **Icons.** `node scripts/make-icons.mjs` regenerates the PNG app icons in `public/`.

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for the licenses of bundled code and the AI models.

## Shortcuts

| Key | Action |
|---|---|
| 1 / 2 / 3 / 4 / L / B / M | Auto / Select / Magic Wand / Color / Lasso / Brush / Shape |
| Esc | Cancel the lasso line or shape being drawn |
| X | Toggle Keep / Remove |
| [ / ] | Smaller / larger brush, or lower / raise tolerance |
| Shift + [ / ] | Softer / harder brush |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Space + drag, middle-drag | Pan |
| Wheel, pinch | Zoom |
| 0 | Fit image to screen |
| Hold C | Show the original |
| V | Switch view: Result / Overlay / Original |
| Shift + drag | Shape: square or circle |
| Hold Undo / Redo, or right-click | List every step and jump to one |
