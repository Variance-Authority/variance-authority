---
'@variance-authority/help': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`uses` and `search` answer a field of a Rust struct and a variant of a Rust enum

`variance ask uses --name size` found nothing in a Rust crate: a struct's
field and an enum's variant were not recorded as members at all. Now each is
declared on its struct or enum, and a field of a struct-like variant on
`Shape::Square`. Each declaration is followed by the lines that read, write or
destructure it:

- `props.size` reads it, also inside a macro such as `assert!`;
- `self.size += 2`, `&mut props.size`, `Props { size: 1, label }` and
  `Props { size, ..base }` write it;
- `let Props { size, .. } = props` and `Shape::Square { size } =>` destructure it;
- `Shape::Dot` in an expression builds a variant and is listed as a write, and
  in a pattern matches it and is listed as a destructure. Only a path names a
  variant, so `Props::size`, a method by that name, is no use of the field.

No type checker runs. A use is tied to its type where the line or its scope
names the type: a struct expression or pattern, `self` and `Self` in an
`impl`, a parameter or `let` annotated as the type or a reference, `Box`,
`Rc` or `Arc` of it. That name is followed through the `use` that binds it,
renamed or not, so `Props::size` and `Other::size` are listed apart; through
a glob, `use crate::shapes::*`, unless the file declares or imports that name
itself; through a module bound by `mod shapes;` or `use crate::shapes;`, so
`shapes::Props` and `shapes::Shape::Square` are read; and through a path from
the crate root, `crate::shapes::Props`. A type an inline module declares is on
the module's path, so `a::Props::size` and `b::Props::size` in one file are
listed apart, and another file reaches it through the module,
`crate::inline::a::Props`. A field reached through a field, `o.inner.size`, is a use on the
type the field `inner` is declared as, in whichever file declares it, inside a
macro's tokens too. Each heading spells the member as a Rust path,
`Shape::Square::size`.

A Rust `use` binds a module only when its whole path names the module's file:
`use crate::config::config` imports the function `config`, not `config.rs`.

`variance ask search` now lists the members whose names hold the query, of
any language the index records them for, under its own heading:

```text
1 more name is declared as a member somewhere in the repository:

Square — on Shape — @acme/kit · packages/kit/src/shapes.rs:12
```

In `--format json` they are `members`, each row with `source: "member"` and
the container it is `on`.

The source index records these with each Rust file's parse, in format version
28; `variance index` rebuilds an older one.
