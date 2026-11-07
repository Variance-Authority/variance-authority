// A preset Jest imports, and `require` cannot read for its top-level await.
await Promise.resolve();
export default {};
