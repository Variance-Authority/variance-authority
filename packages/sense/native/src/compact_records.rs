//! The record columns of one layer, and one row of them read back as the
//! `Indexed` the encoder writes (`compact.rs`).
//!
//! A record is read into owned values rather than viewed in place: it is a
//! handful of short lists, `RecordColumns` already takes it in that shape, and
//! a second row trait for it would be a second layout to keep in step. A list
//! the row marks absent is absent, as `decodeSourceIndex` reads it.

// compass: variance-authority.reach.source-index

use crate::record::{Edge, FileRecord, Indexed};
use crate::stored::{same_length, Stored, U32s};

use super::flag;

pub(crate) struct Records<'a> {
    pub file: U32s<'a>,
    pub deleted: U32s<'a>,
    pub digest: U32s<'a>,
    edges: U32s<'a>,
    edges_present: &'a [u8],
    declares: U32s<'a>,
    declares_present: &'a [u8],
    packages: U32s<'a>,
    packages_present: &'a [u8],
    unresolved: U32s<'a>,
    unresolved_present: &'a [u8],
    unknown: U32s<'a>,
    witnesses: U32s<'a>,
    pub targets: U32s<'a>,
    pub targets_present: &'a [u8],
    witness_directory: U32s<'a>,
    pub target_path: U32s<'a>,
    edge_to: U32s<'a>,
    edge_kind: U32s<'a>,
    declare_name: U32s<'a>,
    unresolved_value: U32s<'a>,
    package_to: U32s<'a>,
    package_kind: U32s<'a>,
}

impl<'a> Records<'a> {
    pub fn open(stored: &Stored<'a>) -> Result<Self, String> {
        let u32s = |name: &str| stored.u32s(name);
        let file = u32s("records.file")?;
        let rows = file.len();
        let (edge_to, declare_name) = (u32s("edges.to")?, u32s("record-declares.name")?);
        let (package_to, unresolved_value) = (u32s("packages.to")?, u32s("unresolved.value")?);
        let (witness_directory, target_path) = (u32s("witnesses.directory")?, u32s("targets.path")?);
        let records = Records {
            file,
            deleted: stored.maybe_u32s("records.deleted")?,
            digest: u32s("records.digest")?,
            edges: stored.offsets("records.edges", rows, edge_to.len())?,
            edges_present: stored.u8s("records.edges-present")?,
            declares: stored.offsets("records.declares", rows, declare_name.len())?,
            declares_present: stored.u8s("records.declares-present")?,
            packages: stored.offsets("records.packages", rows, package_to.len())?,
            packages_present: stored.u8s("records.packages-present")?,
            unresolved: stored.offsets("records.unresolved", rows, unresolved_value.len())?,
            unresolved_present: stored.u8s("records.unresolved-present")?,
            unknown: u32s("records.unknown")?,
            witnesses: stored.offsets("records.witnesses", rows, witness_directory.len())?,
            targets: stored.offsets("records.targets", rows, target_path.len())?,
            targets_present: stored.u8s("records.targets-present")?,
            edge_kind: u32s("edges.kind")?,
            package_kind: u32s("packages.kind")?,
            witness_directory,
            target_path,
            edge_to,
            declare_name,
            unresolved_value,
            package_to,
        };
        same_length(rows, &[
            ("records.digest", records.digest.len()),
            ("records.edges-present", records.edges_present.len()),
            ("records.declares-present", records.declares_present.len()),
            ("records.packages-present", records.packages_present.len()),
            ("records.unresolved-present", records.unresolved_present.len()),
            ("records.unknown", records.unknown.len()),
            ("records.targets-present", records.targets_present.len()),
        ])?;
        same_length(records.edge_to.len(), &[("edges.kind", records.edge_kind.len())])?;
        same_length(records.package_to.len(), &[("packages.kind", records.package_kind.len())])?;
        Ok(records)
    }

    /// The record at `row`, its absent lists absent.
    pub fn indexed(&self, stored: &Stored<'a>, row: usize) -> Indexed {
        let text = |column: U32s, at: usize| stored.text(column.at(at)).to_owned();
        let texts = |offsets: U32s, column: U32s| offsets.range(row).map(|at| text(column, at)).collect::<Vec<_>>();
        let edges = |offsets: U32s, to: U32s, kind: U32s| {
            offsets.range(row).map(|at| Edge { to: text(to, at), kind: text(kind, at) }).collect::<Vec<_>>()
        };
        let present = |column: &[u8]| flag(column, row);
        Indexed {
            record: FileRecord {
                file: text(self.file, row),
                digest: stored.optional(self.digest.at(row)).map(str::to_owned),
                edges: present(self.edges_present).then(|| edges(self.edges, self.edge_to, self.edge_kind)),
                packages: present(self.packages_present)
                    .then(|| edges(self.packages, self.package_to, self.package_kind)),
                declares: present(self.declares_present).then(|| texts(self.declares, self.declare_name)),
                unresolved: present(self.unresolved_present).then(|| texts(self.unresolved, self.unresolved_value)),
                unknown: stored.optional(self.unknown.at(row)).map(str::to_owned),
            },
            witnesses: texts(self.witnesses, self.witness_directory),
            targets: present(self.targets_present).then(|| {
                self.targets
                    .range(row)
                    .map(|at| stored.optional(self.target_path.at(at)).map(str::to_owned))
                    .collect()
            }),
        }
    }
}
