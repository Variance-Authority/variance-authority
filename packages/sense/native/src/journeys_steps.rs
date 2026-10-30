//! What a walk hands back: the steps it placed and how each is known, in the
//! words the prepared journeys file stores and a question prints.

// compass: variance-authority.reach.relations

use crate::journeys_graph::How;
use crate::journeys_roots::Start;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Tag {
    Test,
    Unrecorded,
    Inferred,
    Static,
    Observed,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Known {
    Call(How),
    Reference,
    Handed,
    Made,
    NameMatch,
    New,
    Parameter,
    Enclosed,
}

impl Known {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Known::Call(How::Callback) => "callback",
            Known::Call(How::Local) => "local",
            Known::Call(How::Import) => "import",
            Known::Call(How::Namespace) => "namespace",
            Known::Reference => "reference",
            Known::Handed => "handed",
            Known::Made => "made",
            Known::NameMatch => "name-match",
            Known::New => "new",
            Known::Parameter => "parameter",
            Known::Enclosed => "enclosed",
        }
    }

    /// The byte the prepared file stores.
    pub(crate) fn code(self) -> u8 {
        KNOWN.iter().position(|known| *known == self).expect("every way is listed") as u8
    }

    pub(crate) fn from_code(code: u8) -> Option<Known> {
        KNOWN.get(code as usize).copied()
    }
}

const KNOWN: [Known; 11] = [
    Known::Call(How::Callback),
    Known::Call(How::Local),
    Known::Call(How::Import),
    Known::Call(How::Namespace),
    Known::Reference,
    Known::Handed,
    Known::Made,
    Known::NameMatch,
    Known::New,
    Known::Parameter,
    Known::Enclosed,
];

impl Tag {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Tag::Observed => "observed",
            Tag::Static => "static",
            Tag::Inferred => "inferred",
            Tag::Unrecorded => "unrecorded",
            Tag::Test => "test",
        }
    }

    pub(crate) fn from_code(code: u8) -> Option<Tag> {
        [Tag::Test, Tag::Unrecorded, Tag::Inferred, Tag::Static, Tag::Observed].get(code as usize).copied()
    }
}

pub(crate) struct Step {
    pub depth: u32,
    pub region: Option<u32>,
    pub file: u32,
    pub tag: Tag,
    pub known: Known,
}

pub(crate) struct Walked {
    pub start: Option<Start>,
    pub steps: Vec<Step>,
    /// Functions outside the test file this case entered.
    pub entered: u32,
    /// Of those, the ones a step places.
    pub placed: u32,
}
