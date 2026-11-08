# BackSubtract
A website dedicated to just providing a few quick ways to subtract a background from an image.

Everything runs in the browser — images never leave the device. See [PLAN.md](PLAN.md) for the full design, and [ISSUES.md](ISSUES.md) for known problems still to fix.

## Development

Requires Node 20+.

```bash
npm install
npm run dev      # start the dev server at http://localhost:5173
npm test         # unit tests + golden-image comparisons
npm run golden:update  # regenerate golden/*.png after an intended change (look at them first!)
npm run test:e2e # browser tests (desktop + phone), against a fresh test build
npm run test:e2e:browsers  # the same tests in Firefox and WebKit (best on Linux or macOS)
npm run build    # type-check and build to dist/
```

The first time, install the browser for the e2e tests with `npx playwright install chromium` (and `npx playwright install firefox webkit` for `test:e2e:browsers`). Run Firefox and WebKit on Linux or macOS, or leave them to CI: Playwright's Windows build of WebKit has no `OffscreenCanvas`, which the app needs and Safari has had since 16.4, so nearly every test fails there for a reason Safari users never meet. The e2e tests build in `e2e` mode (into `dist-e2e/`, so `dist/` is never touched): the real app, except that the AI worker is a stand-in (`src/ml/fake-worker.ts`) that simulates the model downloads and returns simple colour-based results. That covers everything around the AI tools without downloading over 100 MB of models on every run; the real models still need trying by hand.

`npm run preview` serves the production build (with the offline service worker) at http://localhost:4173.

## Deploying

The site is static: deploy the `dist/` folder.

- **Headers.** The AI tools need cross-origin isolation: ONNX Runtime's WebAssembly uses shared memory, which Firefox only allows in an isolated page, and other browsers then run the WASM fallback on several threads. `public/_headers` sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, and Netlify and Cloudflare Pages read that file. GitHub Pages can't set headers.
- **File size.** The build is about 1 MB, with no file anywhere near Cloudflare Pages' 25 MiB per-file limit, so Netlify, Cloudflare Pages and GitHub Pages all work. Browsers fetch the AI models from Hugging Face and the ONNX Runtime WebAssembly (27 MB, about 4.7 MB compressed) from jsDelivr the first time an AI tool is used. A small plugin in `vite.config.ts` stops Vite copying the runtime into the build, where nothing would load it.
- **Settings.** Copy `.env.example` to `.env.local`, or set the same variables in the host's build settings:
  - `VITE_DONATE_LINK_*`: Stripe Payment Links for the Donate dialog. The Donate button stays hidden until at least one is set (it always shows under `npm run dev`, so you can see it while working). Set each link's after-payment redirect to `https://<your-site>/?thanks` to show a thank-you message.
  - `VITE_CONTACT_EMAIL`: shown on the About page. Stripe requires public contact details, and a refund policy if you have one.
- **Icons.** `node scripts/make-icons.mjs` regenerates the PNG app icons in `public/`.

### GitHub Pages (for testing)

`.github/workflows/pages.yml` publishes the site to `https://<user>.github.io/<repo>/` on every push to `dev`, or by hand from the Actions tab. It runs the unit tests and `npm run build:pages`, and alongside them the browser tests (`npm run test:e2e`, in Chromium on Linux). The site is deployed only if all of them pass. On CI a failed browser test gets one retry (reported as flaky if it then passes), and the traces of failed tests are attached to the run as `e2e-results`. A third job runs the same tests in Firefox and WebKit (`npm run test:e2e:browsers`). It doesn't hold up the deploy yet: its failures show on that job (with traces as `e2e-browsers-results`), but the run still passes.

- **One-time setup:** in the repository's Settings → Pages → Build and deployment, set Source to **GitHub Actions**. Left on "Deploy from a branch", GitHub also publishes the raw repository on every push (a second "pages build and deployment" run in the Actions tab). That shows a blank page, and the two deployments collide: the workflow's deploy fails with "in progress deployment", or overwrites the raw one minutes later.
- **Subfolder:** Pages serves the site from `/<repo>/`, so that build sets Vite's `base` from `PAGES_BASE` (the workflow fills in the repository name; `/BackSubtract/` locally) and goes to `dist-pages/`. `npm run build` and `dist/` are unaffected.
- **Isolation from the service worker:** Pages can't send the cross-origin isolation headers, so the service worker adds them to what it serves (`public/sw-isolation.js`). The first visit reloads once when the service worker takes over, and so does a hard refresh, which bypasses it. Without this, the AI tools can't run in Firefox. Safari doesn't support `credentialless`, so it isn't isolated there, as on any host.
- **Try it locally first:** `npm run build:pages && npm run preview:pages`, then open http://localhost:4173/BackSubtract/. The preview leaves the isolation headers out, as Pages does, so the service worker adds them there too.

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for the licenses of bundled code and the AI models.

## Shortcuts

| Key | Action |
|---|---|
| 1 / 2 / 3 / 4 / L / B / M | Auto / Select / Magic Wand / Color / Lasso / Brush / Shape |
| Shift + L | Lasso: switch between Magnetic and Polygon |
| Esc | Cancel the lasso line or shape being drawn |
| Enter / double-click | Polygon lasso: close the outline |
| Backspace | Polygon lasso: remove the last corner |
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
| Shift + click | Polygon lasso: sides at 45° angles |
| Shift + click | Brush: straight line from where the last stroke ended |
| Hold Undo / Redo, or right-click | List every step and jump to one |
