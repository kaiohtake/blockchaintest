// Node ESM loader hook used only by scripts/verify.mjs so it can
// dynamic-import the vendored public/vendor/three addons (which import the
// bare specifier 'three', resolved via an import map in the browser) without
// any npm install or bundler. Registered with node:module's register().
const REPO_ROOT = new URL('..', import.meta.url);
const THREE_URL = new URL('public/vendor/three/three.module.js', REPO_ROOT).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: THREE_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
