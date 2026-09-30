//! A call the static resolution missed, placed from the recording.
//!
//! An import the walk cannot resolve, or resolves to a file the case entered
//! nothing in, still ran something: the recording holds what the case entered.
//! The call is placed on the one function the case entered under the name the
//! import asks for. Two or more of that name and the call is ambiguous: it is
//! counted, and none of them is chosen. No test runner's module mapping is
//! modelled here — which file an import meant to the runner is not read, only
//! what the case ran.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use super::{fn_key, Walk};
use crate::journeys_parse::{Callee, Parsed};
use crate::journeys_record::Record;
use crate::journeys_steps::Known;

/// One case's entered functions by name, outside its test file, and the call
/// sites the recording placed or found ambiguous.
pub(super) struct Named<'j> {
    /// Name → the first entered region of that name, and how many there are.
    by_name: HashMap<&'j str, (u32, u32)>,
    /// Call sites (`fn_key(file, call)`) placed on the one function of the name.
    pub placed: Vec<u64>,
    /// Call sites whose name more than one entered function carries.
    pub ambiguous: Vec<u64>,
}

impl<'j> Named<'j> {
    pub(super) fn of(record: &Record<'j>, case: usize, test_file: u32) -> Named<'j> {
        let mut by_name: HashMap<&'j str, (u32, u32)> = HashMap::new();
        for &j in &record.entered[case] {
            let region = &record.regions[j as usize];
            if region.function() && region.file != test_file {
                by_name.entry(region.name).and_modify(|(_, count)| *count += 1).or_insert((j, 1));
            }
        }
        Named { by_name, placed: Vec::new(), ambiguous: Vec::new() }
    }
}

/// The name an import asks its module for: the imported name, or the local one
/// for a default import; for a call through a namespace import, the member.
fn imported<'p>(parsed: &'p Parsed, callee: &'p Callee) -> Option<&'p str> {
    if let Some(id) = callee.id.as_deref() {
        let import = parsed.imports.get(id)?;
        return match import.name.as_str() {
            "*" => None,
            "default" => Some(id),
            name => Some(name),
        };
    }
    let (ns, prop) = (callee.ns.as_deref()?, callee.prop.as_deref()?);
    parsed.imports.get(ns).filter(|import| import.name == "*").map(|_| prop)
}

impl Walk<'_, '_> {
    /// Whether the case entered anything in `file`.
    pub(super) fn ran_in(&self, file: u32) -> bool {
        self.record.regions_of[file as usize].clone().any(|j| self.entered(j))
    }

    /// Call `at` of `file` imports a name the static resolution did not bring
    /// to a function this case entered. Placed from the recording when exactly
    /// one entered function carries the name; `true` when the recording
    /// answered, placed or ambiguous.
    pub(super) fn recorded(&mut self, from: u32, file: u32, at: u32, guard: u32) -> bool {
        let graph = self.graph;
        let Some(parsed) = graph.parsed(file) else { return false };
        let Some(name) = imported(parsed, &parsed.calls[at as usize].callee) else { return false };
        match self.named.by_name.get(name).copied() {
            Some((j, 1)) => {
                // TODO: read a harness's own module mapping and apply it at question
                // time to that harness's tests, as `packages/sense/src/taint/` applies
                // a runner's mocks; the walk stays harness-agnostic, and until then
                // the recording is what places a call the static resolution missed.
                self.named.placed.push(fn_key(file, at));
                let region = &self.record.regions[j as usize];
                self.reach(from, region.file, self.record.fn_for[j as usize], j, guard, Known::Recorded);
                true
            }
            Some(_) => {
                self.named.ambiguous.push(fn_key(file, at));
                true
            }
            None => false,
        }
    }
}
