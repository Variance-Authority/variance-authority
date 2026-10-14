//! A fan-in over stored coverage columns. Crossing sets remain shared sets;
//! no JavaScript object or string is allocated for each crossing.
use crate::journey_columns::{self, Column, Decoded};
use crate::journey_format::SetPool;
use crate::{journey_stitch, order};
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use std::collections::HashMap;
use std::fs;

const WORDS: &[&str] = &[
    "snapshot.instrumentation",
    "snapshot.commit",
    "tests.path",
    "tests.preconditions",
    "tests.duration",
    "preconditions.name",
    "preconditions.digest",
    "modules.path",
    "modules.source",
    "modules.blocks",
    "blocks.ordinal",
    "blocks.owner",
    "blocks.digest",
    "blocks.name",
    "blocks.path",
    "blocks.start",
    "blocks.end",
    "blocks.set",
    "blocks.loadedSet",
    "sets.off",
];
const BYTES: &[&str] = &[
    "tests.complete",
    "modules.instrumented",
    "blocks.kind",
    "blocks.source",
    "sets.blob",
];
const BLOCK_WORDS: &[&str] = &[
    "blocks.ordinal",
    "blocks.owner",
    "blocks.digest",
    "blocks.name",
    "blocks.path",
    "blocks.start",
    "blocks.end",
];

struct Shard {
    strings: Vec<String>,
    words: HashMap<&'static str, Vec<u32>>,
    bytes: HashMap<&'static str, Vec<u8>>,
    tests: Vec<u32>,
    sets: HashMap<u32, Vec<u32>>,
}
impl Shard {
    fn read(path: &str) -> Result<Self, String> {
        let bytes = fs::read(path).map_err(|error| format!("cannot read {path}: {error}"))?;
        let mut decoded = None;
        for version in [10, 9, 8] {
            if let Ok(value) = journey_columns::decode(&bytes, version) {
                decoded = Some(value);
                break;
            }
        }
        let decoded: Decoded =
            decoded.ok_or_else(|| format!("cannot read coverage snapshot {path}"))?;
        let strings = journey_stitch::strings(&decoded)?;
        let mut words = HashMap::new();
        for &name in WORDS {
            let value = if name == "tests.duration" && !decoded.has(name) {
                vec![u32::MAX; decoded.words("tests.path")?.len()]
            } else {
                decoded.words(name)?
            };
            words.insert(name, value);
        }
        let mut plain = HashMap::new();
        for &name in BYTES {
            plain.insert(name, decoded.bytes(name)?);
        }
        let shard = Self {
            strings,
            words,
            bytes: plain,
            tests: Vec::new(),
            sets: HashMap::new(),
        };
        shard.validate()?;
        Ok(shard)
    }
    fn validate(&self) -> Result<(), String> {
        let tests = self.w("tests.path").len();
        let modules = self.w("modules.path").len();
        let blocks = self.w("blocks.ordinal").len();
        if self.w("snapshot.instrumentation").len() != 1
            || self.w("snapshot.commit").len() > 1
            || self.b("tests.complete").len() != tests
            || self.w("tests.duration").len() != tests
            || self.w("modules.source").len() != modules
            || self.b("modules.instrumented").len() != modules
            || BLOCK_WORDS.iter().any(|name| self.w(name).len() != blocks)
            || ["blocks.set", "blocks.loadedSet"]
                .iter()
                .any(|name| self.w(name).len() != blocks)
            || ["blocks.kind", "blocks.source"]
                .iter()
                .any(|name| self.b(name).len() != blocks)
            || self.w("preconditions.name").len() != self.w("preconditions.digest").len()
        {
            return Err("coverage columns disagree".into());
        }
        for (name, rows, end) in [
            (
                "tests.preconditions",
                tests,
                self.w("preconditions.name").len(),
            ),
            ("modules.blocks", modules, blocks),
            (
                "sets.off",
                self.w("sets.off").len().saturating_sub(1),
                self.b("sets.blob").len(),
            ),
        ] {
            let offsets = self.w(name);
            if offsets.len() != rows + 1
                || offsets.first() != Some(&0)
                || offsets.last().copied() != Some(end as u32)
                || offsets.windows(2).any(|pair| pair[0] > pair[1])
            {
                return Err(format!("{name} bounds are invalid"));
            }
        }
        Ok(())
    }
    fn w(&self, name: &str) -> &[u32] {
        &self.words[name]
    }
    fn b(&self, name: &str) -> &[u8] {
        &self.bytes[name]
    }
    fn text(&self, id: u32) -> Result<&str, String> {
        journey_stitch::string(&self.strings, id)
    }
    fn named(&self, column: &str, row: usize) -> Result<&str, String> {
        self.text(
            *self
                .w(column)
                .get(row)
                .ok_or_else(|| format!("{column} row {row} is missing"))?,
        )
    }
    fn members(&mut self, id: u32) -> Result<&[u32], String> {
        if !self.sets.contains_key(&id) {
            let offsets = self.w("sets.off");
            let from = *offsets.get(id as usize).ok_or("coverage set is missing")? as usize;
            let to = *offsets
                .get(id as usize + 1)
                .ok_or("coverage set is missing")? as usize;
            let stored = self
                .b("sets.blob")
                .get(from..to)
                .ok_or("coverage set bounds are invalid")?;
            let own = journey_stitch::decode_set(stored, self.tests.len())?;
            let mapped = own
                .into_iter()
                .map(|local| self.tests[local as usize])
                .collect();
            self.sets.insert(id, mapped);
        }
        Ok(&self.sets[&id])
    }
}

struct Module {
    chosen: (usize, usize),
    rows: Vec<(usize, usize)>,
    instrumented: bool,
}
#[napi(object)]
pub struct CoverageFold {
    pub bytes: Buffer,
    pub tests: u32,
    pub modules: u32,
}

/// Combine shard coverage without expanding the block-to-test relation in V8.
#[napi(catch_unwind)]
pub fn fold_coverage_artifacts(files: Vec<String>) -> napi::Result<CoverageFold> {
    fold(&files).map_err(napi::Error::from_reason)
}
fn fold(files: &[String]) -> Result<CoverageFold, String> {
    if files.is_empty() {
        return Err("folding needs at least one coverage snapshot".into());
    }
    let mut shards = files
        .iter()
        .map(|file| Shard::read(file))
        .collect::<Result<Vec<_>, _>>()?;
    for field in ["instrumentation", "commit"] {
        let name = format!("snapshot.{field}");
        let expected = shards[0]
            .w(&name)
            .first()
            .map(|id| shards[0].text(*id))
            .transpose()?;
        for (at, shard) in shards.iter().enumerate().skip(1) {
            let value = shard
                .w(&name)
                .first()
                .map(|id| shard.text(*id))
                .transpose()?;
            if value != expected {
                return Err(format!(
                    "{} and {} disagree about the {field}",
                    files[0], files[at]
                ));
            }
        }
    }
    let mut tests = Vec::new();
    let mut seen = HashMap::new();
    let mut modules: HashMap<String, Module> = HashMap::new();
    for (at, shard) in shards.iter().enumerate() {
        for row in 0..shard.w("tests.path").len() {
            let file = shard.named("tests.path", row)?.to_owned();
            if let Some(before) = seen.insert(file.clone(), at) {
                return Err(format!(
                    "`{file}` was recorded by {} and again by {}",
                    files[before], files[at]
                ));
            }
            tests.push((file, at, row));
        }
        for row in 0..shard.w("modules.path").len() {
            let file = shard.named("modules.path", row)?.to_owned();
            let instrumented = *shard
                .b("modules.instrumented")
                .get(row)
                .ok_or("module flags disagree")?
                == 1;
            if let Some(held) = modules.get_mut(&file) {
                let (own, previous) = held.chosen;
                if shards[own].named("modules.source", previous)?
                    != shard.named("modules.source", row)?
                {
                    return Err(format!(
                        "`{file}` is different source in {} and {}",
                        files[own], files[at]
                    ));
                }
                if instrumented && !held.instrumented {
                    held.chosen = (at, row);
                    held.rows.clear();
                    held.instrumented = true;
                }
                if instrumented {
                    held.rows.push((at, row));
                }
            } else {
                modules.insert(
                    file,
                    Module {
                        chosen: (at, row),
                        rows: vec![(at, row)],
                        instrumented,
                    },
                );
            }
        }
    }
    tests.sort_by(|left, right| order::code_unit(&left.0, &right.0));
    for shard in &mut shards {
        shard.tests.resize(shard.w("tests.path").len(), 0);
    }
    for (global, (_, shard, local)) in tests.iter().enumerate() {
        shards[*shard].tests[*local] = global as u32;
    }
    let mut strings: Vec<String> = shards
        .iter()
        .flat_map(|shard| shard.strings.iter().cloned())
        .collect();
    strings.sort_by(|left, right| order::code_unit(left, right));
    strings.dedup();
    let ids: HashMap<&str, u32> = strings
        .iter()
        .enumerate()
        .map(|(at, string)| (string.as_str(), at as u32))
        .collect();
    let mut blob = Vec::new();
    let mut offsets = vec![0];
    for string in &strings {
        blob.extend_from_slice(string.as_bytes());
        offsets.push(blob.len() as u32);
    }
    let mut output = vec![
        Column::Blob("strings.blob", blob, offsets.clone()),
        Column::Words("strings.off", offsets),
    ];
    for name in ["snapshot.instrumentation", "snapshot.commit"] {
        output.push(Column::Words(
            name,
            shards[0]
                .w(name)
                .iter()
                .map(|word| shards[0].text(*word).map(|text| ids[text]))
                .collect::<Result<_, _>>()?,
        ));
    }
    let mut paths = Vec::new();
    let mut complete = Vec::new();
    let mut duration = Vec::new();
    let mut boundaries = vec![0];
    let mut pre_names = Vec::new();
    let mut pre_digests = Vec::new();
    for (file, at, row) in &tests {
        let shard = &shards[*at];
        paths.push(ids[file.as_str()]);
        complete.push(
            *shard
                .b("tests.complete")
                .get(*row)
                .ok_or("test flags disagree")?,
        );
        duration.push(
            *shard
                .w("tests.duration")
                .get(*row)
                .ok_or("test durations disagree")?,
        );
        let bounds = shard.w("tests.preconditions");
        let from = *bounds.get(*row).ok_or("test preconditions disagree")?;
        let to = *bounds.get(*row + 1).ok_or("test preconditions disagree")?;
        for input in from..to {
            pre_names.push(ids[shard.named("preconditions.name", input as usize)?]);
            pre_digests.push(ids[shard.named("preconditions.digest", input as usize)?]);
        }
        boundaries.push(pre_names.len() as u32);
    }
    output.extend([
        Column::Words("tests.path", paths),
        Column::Bytes("tests.complete", complete),
        Column::Words("tests.duration", duration),
        Column::Words("tests.preconditions", boundaries),
        Column::Words("preconditions.name", pre_names),
        Column::Words("preconditions.digest", pre_digests),
    ]);
    let mut named: Vec<_> = modules.into_iter().collect();
    named.sort_by(|left, right| order::code_unit(&left.0, &right.0));
    let mut module_paths = Vec::new();
    let mut source = Vec::new();
    let mut flags = Vec::new();
    let mut blocks = vec![0];
    let mut block_words: HashMap<&'static str, Vec<u32>> =
        BLOCK_WORDS.iter().map(|name| (*name, Vec::new())).collect();
    let mut kinds = Vec::new();
    let mut sources = Vec::new();
    let mut called = Vec::new();
    let mut loaded = Vec::new();
    let mut sets = SetPool::new(tests.len());
    let mut unions: HashMap<Vec<(usize, u32)>, u32> = HashMap::new();
    for (file, module) in &named {
        let (own, row) = module.chosen;
        module_paths.push(ids[file.as_str()]);
        source.push(ids[shards[own].named("modules.source", row)?]);
        flags.push(u8::from(module.instrumented));
        let bounds = shards[own].w("modules.blocks");
        let from = *bounds.get(row).ok_or("module block bounds disagree")? as usize;
        let to = *bounds.get(row + 1).ok_or("module block bounds disagree")? as usize;
        let mut positions = Vec::new();
        for (at, local) in &module.rows {
            let bounds = shards[*at].w("modules.blocks");
            let begin = *bounds.get(*local).ok_or("module block bounds disagree")? as usize;
            let end = *bounds
                .get(*local + 1)
                .ok_or("module block bounds disagree")? as usize;
            let mut map = HashMap::new();
            for block in begin..end {
                map.insert(
                    *shards[*at]
                        .w("blocks.ordinal")
                        .get(block)
                        .ok_or("block ordinal is missing")?,
                    block,
                );
            }
            positions.push((*at, map));
        }
        for block in from..to {
            let ordinal = *shards[own]
                .w("blocks.ordinal")
                .get(block)
                .ok_or("block ordinal is missing")?;
            for &name in BLOCK_WORDS {
                let word = *shards[own]
                    .w(name)
                    .get(block)
                    .ok_or("block columns disagree")?;
                let value = if matches!(name, "blocks.digest" | "blocks.name" | "blocks.path") {
                    ids[shards[own].text(word)?]
                } else {
                    word
                };
                block_words.get_mut(name).unwrap().push(value);
            }
            kinds.push(
                *shards[own]
                    .b("blocks.kind")
                    .get(block)
                    .ok_or("block kind is missing")?,
            );
            sources.push(
                *shards[own]
                    .b("blocks.source")
                    .get(block)
                    .ok_or("block source is missing")?,
            );
            for (name, column) in [
                ("blocks.set", &mut called),
                ("blocks.loadedSet", &mut loaded),
            ] {
                let signature = positions
                    .iter()
                    .filter_map(|(at, map)| map.get(&ordinal).map(|block| (*at, *block)))
                    .map(|(at, block)| {
                        shards[at]
                            .w(name)
                            .get(block)
                            .copied()
                            .map(|set| (at, set))
                            .ok_or("block set is missing")
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let id = if let Some(id) = unions.get(&signature) {
                    *id
                } else {
                    let mut members = Vec::new();
                    for (at, set) in &signature {
                        members.extend_from_slice(shards[*at].members(*set)?);
                    }
                    members.sort_unstable();
                    members.dedup();
                    let id = sets.intern(&members);
                    unions.insert(signature, id);
                    id
                };
                column.push(id);
            }
        }
        blocks.push(kinds.len() as u32);
    }
    output.extend([
        Column::Words("modules.path", module_paths),
        Column::Words("modules.source", source),
        Column::Bytes("modules.instrumented", flags),
        Column::Words("modules.blocks", blocks),
    ]);
    for &name in BLOCK_WORDS {
        output.push(Column::Words(name, block_words.remove(name).unwrap()));
    }
    output.extend([
        Column::Bytes("blocks.kind", kinds),
        Column::Bytes("blocks.source", sources),
        Column::Words("blocks.set", called),
        Column::Words("blocks.loadedSet", loaded),
        Column::Blob("sets.blob", sets.bytes().to_vec(), sets.offsets().to_vec()),
        Column::Words("sets.off", sets.offsets().to_vec()),
    ]);
    let bytes = journey_columns::encode(output, 10)?;
    Ok(CoverageFold {
        bytes: bytes.into(),
        tests: tests.len() as u32,
        modules: named.len() as u32,
    })
}
