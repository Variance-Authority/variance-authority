---
'@variance-authority/sense': patch
'@variance-authority/help': patch
---

A Rust inline module is a module of its own

`use super::helper` inside `mod tests { … }` in `foo.rs` names `foo.rs`, and a
`use` inside an inline module was read as if the file had written it, so it
landed on `lib.rs` or on the file's parent. `self` and `super` there now name
the inline module and the one around it, and a path that names the file it is
written in is no edge. A `#[path]` inside an inline module is read from that
module's directory, `a/b/inline/other.rs` in `a/b.rs`, and a `#[path]` at the
top of a file from the directory the file is in. A `pub use` inside an inline
module is no export of the file.

`ask symbol` answers an item inside an inline module, declared on its module
path, `tests::fixture`, asked for by that path or by its own name. A `pub` one
there says who can reach it is not recorded, since the modules around it decide.
A `pub` one whose inline modules are all `pub` is not declared on its own: the
file exports the outermost of them, and you ask for that module by name.
