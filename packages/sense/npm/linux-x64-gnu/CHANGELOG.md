# @variance-authority/sense-linux-x64-gnu

## 0.5.10

## 0.5.9

### Patch Changes

- 50be015: Instrument modules in the native scanner
  
  `instrument()` now parses, walks and splices in the addon, so the syntax tree
  never crosses into JavaScript: 64 µs a module instead of 161 µs over this
  repository's sources, byte for byte the same output. Without the addon, the
  JavaScript walk answers as before.
  
  A module whose first statement after its imports is a top-level `await` no
  longer loses its probe runtime: the header used to land inside the `await`'s
  probe and was not declared.
  
  The scanner on Apple Silicon hashes with the ARMv8 SHA instructions, five
  times faster than before, which every digest it takes shares.
- 5a4238b: Build the Linux scanner against glibc 2.17
  
  The Linux scanner was linked against the build runner's glibc and asked for
  2.39, so it failed to load on Debian 12 and Ubuntu 22.04 while Node and oxc ran
  there. It now asks for 2.17, below the 2.28 Node 22 itself needs, and a release
  refuses a binary that asks for more.

## 0.5.8

## 0.5.7

## 0.5.6

### Patch Changes

- 9e1b8ef: Refuse to publish a native Sense package without its scanner binary
  
  Each platform package checks that `scan.node` exists and is large enough to be
  the compiled scanner before a pack or publish can proceed.

## 0.5.5

## 0.5.4

## 0.5.3

## 0.5.2

## 0.5.1

## 0.5.0

## 0.4.1

## 0.4.0

## 0.3.0
