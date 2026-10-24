//! What a binding the walk follows holds, and the request it reads through.

use std::collections::HashMap;

/// The request a holder reads through: its index in the parse, its index in
/// `loads.required`, which the parse appends after every `import()`, or its
/// index in `loads.typed`, which the parse appends after those, or the
/// `import()` type starting at an offset, whose index the walk may meet later.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Via {
    Indexed(u32),
    Required(u32),
    Typed(u32),
    TypedAt(u32),
}

impl Via {
    pub(super) fn index(self, required: u32, typed: u32, typed_at: &HashMap<u32, u32>) -> Option<u32> {
        Some(match self {
            Via::Indexed(index) => index,
            Via::Required(index) => required + index,
            Via::Typed(index) => typed + index,
            Via::TypedAt(at) => typed + typed_at.get(&at)?,
        })
    }
}

/// What a value holds: the module a request loads, or, `off`, that module's
/// `default`; or, `named`, the value a named import of the request takes, by
/// the binding's index in the request.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Held {
    pub(super) via: Via,
    pub(super) off: bool,
    pub(super) named: Option<u32>,
}

impl Held {
    pub(super) fn whole(via: Via) -> Self {
        Held { via, off: false, named: None }
    }

    /// The value the named import at `binding` of the request takes. Which
    /// names a read off it reaches is the module's to say only when the value
    /// is a namespace it passes on, which the query decides.
    pub(super) fn named(via: Via, binding: u32) -> Self {
        Held { via, off: false, named: Some(binding) }
    }

    /// The module's `default`. Interop nests one level, so the `default` of
    /// a `default` is the same level: `ns.default.default.x` reads `x` through it.
    pub(super) fn default(self) -> Self {
        Held { off: true, ..self }
    }
}

/// The token a member read takes when the module goes somewhere the walk does
/// not follow, as a binding takes it for the namespace whole.
pub(super) const WHOLE: &str = "*";
