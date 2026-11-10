import { describe, expect, it } from 'vitest';
import { fileUrl, isOtherRevision, ISNET, REPOS, SELECT } from './models';

const HOST = 'https://huggingface.co/';

describe('AI model repositories', () => {
  it('fixes every model to a full commit hash, not a branch or tag', () => {
    for (const repo of REPOS) expect(repo.revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it('builds the URL Transformers.js downloads from and caches under', () => {
    expect(fileUrl(HOST, ISNET, 'onnx/model_fp16.onnx')).toBe(
      `https://huggingface.co/imgly/isnet-general-onnx/resolve/${ISNET.revision}/onnx/model_fp16.onnx`,
    );
  });

  it('spots files from main or another commit, so they can be deleted', () => {
    expect(isOtherRevision(HOST, `${HOST}imgly/isnet-general-onnx/resolve/main/onnx/model.onnx`)).toBe(true);
    expect(isOtherRevision(HOST, `${HOST}imgly/isnet-general-onnx/resolve/main/config.json`)).toBe(true);
    expect(isOtherRevision(HOST, `${HOST}Xenova/slimsam-77-uniform/resolve/${'0'.repeat(40)}/onnx/x.onnx`)).toBe(true);
  });

  it('keeps the files in use, and anything that is not one of these models', () => {
    expect(isOtherRevision(HOST, fileUrl(HOST, ISNET, 'onnx/model.onnx'))).toBe(false);
    expect(isOtherRevision(HOST, fileUrl(HOST, SELECT, 'preprocessor_config.json'))).toBe(false);
    expect(isOtherRevision(HOST, `${HOST}someone/other-model/resolve/main/onnx/model.onnx`)).toBe(false);
    expect(isOtherRevision(HOST, 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm')).toBe(false);
  });
});
