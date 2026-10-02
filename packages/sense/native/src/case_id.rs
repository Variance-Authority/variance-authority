//! A case's id, as `caseIds` in `cases.ts` spells it: `<file> >
//! <name>`, and `#n` on the `n`-th further case of that file and name, counted
//! in the order of the ids their runner gave them.
//!
//! The number says where a case stands among the cases a fold saw, so a shard
//! that ran only the second of two cases sharing a name calls it by the first
//! one's id. The runner's id is what tells them apart: a fold carries it beside
//! the case id, and a stitch joins by it and numbers the union again.

use std::cmp::Ordering;
use std::collections::HashMap;

use crate::order;

/// The column the runner's id for each case is carried in.
pub const COLUMN: &str = "tests.runnerId";

/// The order cases are numbered in: by file, then name, then the runner's id.
pub fn order(left: (&str, &str, &str), right: (&str, &str, &str)) -> Ordering {
    order::code_unit(left.0, right.0)
        .then_with(|| order::code_unit(left.1, right.1))
        .then_with(|| order::code_unit(left.2, right.2))
}

/// Names cases handed over in [`order`].
#[derive(Default)]
pub struct CaseIds {
    repeated: HashMap<String, u32>,
    /// The name of the case holding each id handed out.
    held: HashMap<String, String>,
}

impl CaseIds {
    /// The next case's id, or the refusal when a case named `pays#1` and the
    /// second case named `pays` would share one: a runner reports such a suite
    /// as it is, and one id cannot hold two cases' journeys.
    pub fn next(&mut self, file: &str, name: &str) -> Result<String, String> {
        let named = format!("{file} > {name}");
        let repeat = self.repeated.entry(named.clone()).or_default();
        let id = if *repeat == 0 { named } else { format!("{named}#{repeat}") };
        *repeat += 1;
        if let Some(holder) = self.held.get(&id) {
            let literal = &id[file.len() + 3..];
            let numbered = if holder == literal { name } else { holder };
            return Err(format!(
                "cannot number the cases of {file}: \"{literal}\" is the name of one case and the number of a repeated \"{numbered}\". Rename one of them."
            ));
        }
        self.held.insert(id.clone(), name.to_owned());
        Ok(id)
    }
}
