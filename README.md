# BackSubtract
A website dedicated to just providing a few quick ways to subtract a background from an image.

Everything runs in the browser — images never leave the device. See [PLAN.md](PLAN.md) for the full design.

## Development

Requires Node 20+.

```bash
npm install
npm run dev      # start the dev server at http://localhost:5173
npm test         # unit tests
npm run build    # type-check and build to dist/
```

## Shortcuts

| Key | Action |
|---|---|
| B | Brush |
| X | Toggle Keep / Remove |
| [ / ] | Smaller / larger brush |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Space + drag, middle-drag | Pan |
| Wheel, pinch | Zoom |
| 0 | Fit image to screen |
| Hold C | Show the original |
