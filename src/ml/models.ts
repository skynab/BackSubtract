/**
 * The AI models' Hugging Face repositories, each fixed to one commit. The app then always
 * downloads the files it was tested with, at the sizes it shows before asking (worker.ts),
 * whatever the repositories' owners push later.
 *
 * Moving a model to a newer commit is a deliberate change: try the model, and update its
 * sizes in worker.ts in the same change. The Hugging Face API lists them:
 * https://huggingface.co/api/models/<id>/tree/<commit>/onnx
 */
export interface Repo {
  id: string;
  /** A full commit hash: a branch or tag name could move. */
  revision: string;
}

/** Background removal on GPUs that can run it (MIT). */
export const BIREFNET: Repo = {
  id: 'onnx-community/BiRefNet_lite-ONNX',
  revision: 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1',
};

/** Background removal everywhere else (DIS, Apache-2.0 weights). */
export const ISNET: Repo = {
  id: 'imgly/isnet-general-onnx',
  revision: '440dea96dd4a3b06bbbf5abec3e26569dd7ec49f',
};

/** Segment Anything for Select: SlimSAM-77 (Apache-2.0). */
export const SELECT: Repo = {
  id: 'Xenova/slimsam-77-uniform',
  revision: '5850ab45f587c112167512ffef949107115e26a0',
};

export const REPOS: readonly Repo[] = [BIREFNET, ISNET, SELECT];

/**
 * Where Transformers.js downloads a model file from, which is also its key in the
 * browser's cache. `host` is Transformers.js's `env.remoteHost`, ending in a slash.
 */
export const fileUrl = (host: string, repo: Repo, path: string) => `${host}${repo.id}/resolve/${repo.revision}/${path}`;

/**
 * Whether a cached URL is a file of one of these models from a commit other than the one
 * used now. Versions before the models were fixed downloaded them from `main`.
 */
export function isOtherRevision(host: string, url: string): boolean {
  return REPOS.some((repo) => {
    const prefix = `${host}${repo.id}/resolve/`;
    return url.startsWith(prefix) && !url.startsWith(`${prefix}${repo.revision}/`);
  });
}
