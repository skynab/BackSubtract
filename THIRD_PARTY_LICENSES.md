# Third-party licenses

BackSubtract is licensed under Apache-2.0 (see [LICENSE](LICENSE)). It uses only permissively licensed code and models, so it can be offered free with optional donations.

Before adding a model or library, check its license **and the license of the model weights**.

## AI models (downloaded by the browser on first use)

| Model | Used for | License | Source |
|---|---|---|---|
| BiRefNet-lite (ONNX) | Auto, on GPUs that can run it | MIT | https://huggingface.co/onnx-community/BiRefNet_lite-ONNX |
| IS-Net general-use (ONNX) | Auto, everywhere else | Apache-2.0 weights (DIS, xuebinqin/DIS); ONNX build tagged MIT | https://huggingface.co/imgly/isnet-general-onnx |
| SlimSAM-77 uniform | Select | Apache-2.0 | https://huggingface.co/Xenova/slimsam-77-uniform |

## Libraries (bundled with the site)

| Library | License |
|---|---|
| @huggingface/transformers (Transformers.js) | Apache-2.0 |
| onnxruntime-web | MIT |
| react, react-dom | MIT |
| zustand | MIT |
| i18next, react-i18next | MIT |

## Build tools (not shipped)

| Tool | License |
|---|---|
| Vite, @vitejs/plugin-react | MIT |
| TypeScript | Apache-2.0 |
| Vitest | MIT |

## Deliberately not used

| Component | Why |
|---|---|
| BRIA RMBG-1.4 / 2.0 | Non-commercial license; donations could count as commercial use |
| @imgly/background-removal (npm) | AGPL-3.0; copyleft conflicts with this project's Apache-2.0 license |
