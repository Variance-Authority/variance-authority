//! A case's id, as `caseIds` in `cases.ts` spells it: `<file> >
//! <name>`, `|<project>| <file> > <name>` for a case a named project ran, and
//! `#n` on the `n`-th further case of that prefix and name, counted in the
//! order of the ids their runner gave them.
//!
//! The number says where a case stands among the cases a fold saw, so a shard
//! that ran only the second of two cases sharing a name calls it by the first
//! one's id. The runner's id is what tells them apart: a fold carries it beside
//! the case id, and a stitch joins by it and numbers the union again. The
//! project is the case's own, so a run filtered to one project names its copy
//! as a full run does.

use std::cmp::Ordering;
use std::collections::HashMap;

use crate::order;

/// The column the runner's id for each case is carried in.
pub const COLUMN: &str = "tests.runnerId";

/// The column the project that ran each case is carried in, when any did.
pub const PROJECT_COLUMN: &str = "tests.project";

/// A case no named project ran, in [`PROJECT_COLUMN`].
pub const UNNAMED: u32 = 0xffff_ffff;

/// A case as it is numbered: file, name, project, and the runner's id.
pub type Numbered<'a> = (&'a str, &'a str, Option<&'a str>, &'a str);

/// The order cases are numbered in: by file, then name, then project, then the runner's id.
pub fn order(left: Numbered, right: Numbered) -> Ordering {
    order::code_unit(left.0, right.0)
        .then_with(|| order::code_unit(left.1, right.1))
        .then_with(|| order::code_unit(left.2.unwrap_or(""), right.2.unwrap_or("")))
        .then_with(|| order::code_unit(left.3, right.3))
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
    pub fn next(&mut self, file: &str, name: &str, project: Option<&str>) -> Result<String, String> {
        let prefix = match project {
            Some(project) => format!("|{project}| {file} > "),
            None => format!("{file} > "),
        };
        let named = format!("{prefix}{name}");
        let repeat = self.repeated.entry(named.clone()).or_default();
        let id = if *repeat == 0 { named } else { format!("{named}#{repeat}") };
        *repeat += 1;
        if let Some(holder) = self.held.get(&id) {
            let literal = &id[prefix.len()..];
            let numbered = if holder == literal { name } else { holder };
            return Err(format!(
                "cannot number the cases of {file}: \"{literal}\" is the name of one case and the number of a repeated \"{numbered}\". Rename one of them."
            ));
        }
        self.held.insert(id.clone(), name.to_owned());
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::CaseIds;

    #[test]
    fn names_each_project_copy_of_a_case_by_its_project() {
        let mut ids = CaseIds::default();
        assert_eq!(ids.next("a.test.ts", "pays", Some("dom")).unwrap(), "|dom| a.test.ts > pays");
        assert_eq!(ids.next("a.test.ts", "pays", Some("node")).unwrap(), "|node| a.test.ts > pays");
        assert_eq!(ids.next("a.test.ts", "pays", None).unwrap(), "a.test.ts > pays");
        assert_eq!(ids.next("a.test.ts", "pays", Some("node")).unwrap(), "|node| a.test.ts > pays#1");
    }

    #[test]
    fn refuses_a_project_copy_whose_number_is_a_name() {
        let mut ids = CaseIds::default();
        ids.next("a.test.ts", "pays", Some("dom")).unwrap();
        ids.next("a.test.ts", "pays#1", Some("dom")).unwrap();
        let refused = ids.next("a.test.ts", "pays", Some("dom")).unwrap_err();
        assert!(refused.contains("\"pays#1\" is the name of one case"), "{refused}");
    }
}
