//! The modules behind the `help` questions, declared together.
//!
//! The crate root names them through `use help::*`, so a sibling reaches each
//! as `crate::help_usage` as before.

// compass: variance-authority.report.agent-surface

#[path = "help_aliases.rs"]
pub(crate) mod help_aliases;
#[path = "help_declared.rs"]
pub(crate) mod help_declared;
#[path = "help_grep.rs"]
pub(crate) mod help_grep;
#[path = "help_in_file.rs"]
pub(crate) mod help_in_file;
#[path = "help_member_uses.rs"]
pub(crate) mod help_member_uses;
#[path = "help_members.rs"]
pub(crate) mod help_members;
#[path = "help_origin.rs"]
pub(crate) mod help_origin;
#[path = "help_own_uses.rs"]
pub(crate) mod help_own_uses;
#[path = "help_publish.rs"]
pub(crate) mod help_publish;
#[path = "help_search.rs"]
pub(crate) mod help_search;
#[path = "help_usage.rs"]
pub(crate) mod help_usage;
