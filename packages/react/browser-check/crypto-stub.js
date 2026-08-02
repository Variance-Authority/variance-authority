// Stand-in for `node:crypto` so the bundle links in a browser.
//
// NOT a sha256, and not something anything real may use. Its only job is to let
// `@variance-authority/core`'s `digestString` link in a page so the *fiber
// traversal* can be verified in a real engine.
//
// `core` importing `node:crypto` is itself the finding. `propsDigest` has to run
// where the props are — a prop can be a function or an element, and neither
// survives a trip out of the page — so the digest is computed in the browser,
// and `core`'s only hash implementation cannot run there. Recorded in
// docs/context/journal/0002-fiber-provenance.md; the fix belongs to `core`, not
// here, and this stub disappears when it lands.
export function createHash() {
  let h = 0x811c9dc5;
  return {
    update(text) {
      for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return this;
    },
    digest() {
      return h.toString(16).padStart(8, '0').repeat(8);
    },
  };
}
export default { createHash };
