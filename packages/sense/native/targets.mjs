/**
 * Every target we publish a package for, by the Rust triple that builds it.
 *
 * `package` is the directory under `npm/`, and `tools/native-packages.check.ts`
 * holds it against the manifest's `optionalDependencies` and the loader's own
 * table. `artifact` is what `cargo` calls the `cdylib` on that platform.
 *
 * `glibc` is the oldest glibc the binary links against, and it is chosen to add
 * nothing to what an install already demands. Node 22 needs 2.28 and oxc needs
 * 2.14; a scanner built on the runner's own glibc needed 2.39, which is a
 * requirement nobody asked this package to have and one that fails as a
 * `dlopen` on Debian 12. 2.17 is the oldest glibc Rust's standard library
 * supports. The build links against it through `cargo zigbuild`, and
 * `scripts/verify-native-pack.mjs` refuses a binary that asks for more.
 */
export const TARGETS = {
  'aarch64-apple-darwin': { package: 'darwin-arm64', artifact: 'libsense_native.dylib' },
  'x86_64-unknown-linux-gnu': {
    package: 'linux-x64-gnu',
    artifact: 'libsense_native.so',
    glibc: '2.17',
  },
  'x86_64-pc-windows-msvc': { package: 'win32-x64-msvc', artifact: 'sense_native.dll' },
};
