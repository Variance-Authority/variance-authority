//! The one fold of coverage: N shards' coverage as the coverage one unsharded
//! run would have written, or a refusal naming the two shards that disagree.
//!
//! The rule is that the fold says nothing one run could not. The probe recipe
//! and the commit are singular in a run, so every shard must name the same
//! ones; absent is a value there. A test file belongs to one shard. A module
//! the shards built from different text is refused, since the regions of one do
//! not name the regions of the other. Where shards disagree about whether a
//! module was readable, the rows that measured it answer and the others say
//! nothing; rows that agree are one union, region by region, by ordinal. A
//! region two shards describe differently is refused.
//!
//! The output is a function of the shards' contents only: tests and modules
//! are written in code-unit order of their paths, ids are ranks in that order,
//! every set is ascending, and the dictionary holds exactly the strings the
//! output names, sorted.

use rustc_hash::FxHashMap;

use crate::case_shard;
use crate::journey_columns::Column;
use crate::journey_format::SetPool;
use crate::order;
use crate::record_coverage::Coverage;
use crate::record_layout::LAYOUT;

/// One shard's coverage and the name a refusal calls it by.
pub(crate) struct Shard<'a> {
    pub name: &'a str,
    pub coverage: &'a Coverage,
}

pub(crate) struct Folded {
    /// The coverage sections, in the order a record holds them.
    pub columns: Vec<Column>,
    pub tests: u32,
    pub modules: u32,
    pub crossings: u64,
    pub commit: Option<String>,
    /// Per shard, the test files it recorded.
    pub files: Vec<Vec<String>>,
}

/// Strings named by the output, interned in any order and numbered by rank once all are known.
#[derive(Default)]
struct Dictionary<'a> {
    ids: FxHashMap<&'a str, u32>,
    values: Vec<&'a str>,
}

impl<'a> Dictionary<'a> {
    fn id(&mut self, value: &'a str) -> u32 {
        if let Some(id) = self.ids.get(value) {
            return *id;
        }
        let id = self.values.len() as u32;
        self.ids.insert(value, id);
        self.values.push(value);
        id
    }

    /// The strings sorted, and the rank each interned id takes among them.
    fn ranked(self) -> (Vec<&'a str>, Vec<u32>) {
        let mut sorted: Vec<u32> = (0..self.values.len() as u32).collect();
        sorted.sort_unstable_by(|left, right| order::code_unit(self.values[*left as usize], self.values[*right as usize]));
        let mut rank = vec![0; sorted.len()];
        for (at, id) in sorted.iter().enumerate() {
            rank[*id as usize] = at as u32;
        }
        (sorted.iter().map(|id| self.values[*id as usize]).collect(), rank)
    }
}

#[derive(Default)]
struct Columns {
    test_path: Vec<u32>,
    test_complete: Vec<u8>,
    test_preconditions: Vec<u32>,
    test_duration: Vec<u32>,
    precondition_name: Vec<u32>,
    precondition_digest: Vec<u32>,
    module_path: Vec<u32>,
    module_source: Vec<u32>,
    module_instrumented: Vec<u8>,
    module_blocks: Vec<u32>,
    block_ordinal: Vec<u32>,
    block_kind: Vec<u8>,
    block_owner: Vec<u32>,
    block_digest: Vec<u32>,
    block_name: Vec<u32>,
    block_path: Vec<u32>,
    block_start: Vec<u32>,
    block_end: Vec<u32>,
    block_source: Vec<u8>,
    block_set: Vec<u32>,
    block_loaded_set: Vec<u32>,
}

pub(crate) fn fold(shards: &[Shard<'_>]) -> Result<Folded, String> {
    let first = shards.first().ok_or("folding needs at least one coverage record")?;
    let strings: Vec<Vec<&str>> = shards.iter().map(|shard| shard.coverage.strings()).collect::<Result<_, _>>()?;
    let string = |shard: usize, id: u32| strings[shard][id as usize];
    let instrumentation = |shard: usize| string(shard, shards[shard].coverage.instrumentation);
    let commit = |shard: usize| shards[shard].coverage.commit.map(|id| string(shard, id));
    for at in 1..shards.len() {
        agree(first.name, shards[at].name, "instrumentation", instrumentation(0), instrumentation(at))?;
        agree(first.name, shards[at].name, "commit", commit(0).unwrap_or("(none)"), commit(at).unwrap_or("(none)"))?;
    }
    let mut dictionary = Dictionary::default();
    let mut out = Columns::default();
    let instrumentation_id = dictionary.id(instrumentation(0));
    let commit_id = commit(0).map(|value| dictionary.id(value));

    // Tests, by path. Ids are ranks, so they do not depend on which shard held a test.
    let mut tests: Vec<(&str, usize, usize)> = Vec::new();
    for (at, shard) in shards.iter().enumerate() {
        tests.extend(shard.coverage.test_path.iter().enumerate().map(|(local, path)| (string(at, *path), at, local)));
    }
    tests.sort_by(|left, right| order::code_unit(left.0, right.0).then(left.1.cmp(&right.1)));
    if let Some(pair) = tests.windows(2).find(|pair| pair[0].0 == pair[1].0) {
        return Err(format!(
            "`{}` was recorded by {} and again by {}. A test file belongs to one shard, and two observations of it cannot both be the suite's.",
            pair[0].0, shards[pair[0].1].name, shards[pair[1].1].name
        ));
    }
    let mut global: Vec<Vec<u32>> = shards.iter().map(|shard| vec![0; shard.coverage.tests()]).collect();
    let mut files: Vec<Vec<String>> = vec![Vec::new(); shards.len()];
    for (rank, (path, at, local)) in tests.iter().enumerate() {
        let held = shards[*at].coverage;
        global[*at][*local] = rank as u32;
        files[*at].push((*path).to_owned());
        out.test_path.push(dictionary.id(path));
        out.test_complete.push(held.test_complete[*local]);
        out.test_duration.push(held.test_duration.as_ref().map_or(LAYOUT.coverage.no_duration, |duration| duration[*local]));
        out.test_preconditions.push(out.precondition_name.len() as u32);
        for input in held.preconditions(*local) {
            out.precondition_name.push(dictionary.id(string(*at, held.precondition_name[input])));
            out.precondition_digest.push(dictionary.id(string(*at, held.precondition_digest[input])));
        }
    }
    out.test_preconditions.push(out.precondition_name.len() as u32);

    // Modules, by path, each folded from the rows that measured it.
    let mut rows: Vec<(&str, usize, usize)> = Vec::new();
    for (at, shard) in shards.iter().enumerate() {
        rows.extend(shard.coverage.module_path.iter().enumerate().map(|(local, path)| (string(at, *path), at, local)));
    }
    rows.sort_by(|left, right| order::code_unit(left.0, right.0).then(left.1.cmp(&right.1)).then(left.2.cmp(&right.2)));
    let mut sets = SetPool::new(tests.len());
    let mut crossings = 0_u64;
    let (mut called, mut loaded) = (Vec::new(), Vec::new());
    let mut from = 0;
    while from < rows.len() {
        let file = rows[from].0;
        let to = from + rows[from..].iter().take_while(|row| row.0 == file).count();
        let group = &rows[from..to];
        from = to;
        let source = |(_, at, local): &(&str, usize, usize)| string(*at, shards[*at].coverage.module_source[*local]);
        if let Some(other) = group.iter().find(|row| source(row) != source(&group[0])) {
            return Err(format!(
                "`{file}` is different source in {} and {}: the two shards built it from different text, so the regions of one do not name the regions of the other.",
                shards[group[0].1].name, shards[other.1].name
            ));
        }
        let instrumented = group.iter().any(|(_, at, local)| shards[*at].coverage.module_instrumented[*local] == 1);
        let mut blocks: Vec<(u32, usize, usize)> = Vec::new();
        for (_, at, local) in group {
            let held = shards[*at].coverage;
            if (held.module_instrumented[*local] == 1) == instrumented {
                blocks.extend(held.blocks(*local).map(|block| (held.block_ordinal[block], *at, block)));
            }
        }
        blocks.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)).then(left.2.cmp(&right.2)));
        out.module_path.push(dictionary.id(file));
        out.module_source.push(dictionary.id(source(&group[0])));
        out.module_instrumented.push(u8::from(instrumented));
        out.module_blocks.push(out.block_ordinal.len() as u32);
        let mut at = 0;
        while at < blocks.len() {
            let ordinal = blocks[at].0;
            let end = at + blocks[at..].iter().take_while(|block| block.0 == ordinal).count();
            let (_, shard, row) = blocks[at];
            called.clear();
            loaded.clear();
            for (_, other, other_row) in &blocks[at..end] {
                let same = region(shards, &strings, (shard, row), (*other, *other_row));
                if !same {
                    return Err(format!(
                        "`{file}` region {ordinal} is described differently by {} and {}, so they are not shards of one build.",
                        shards[shard].name, shards[*other].name
                    ));
                }
                let held = shards[*other].coverage;
                members(held, held.block_set[*other_row], &global[*other], &mut called)?;
                members(held, held.block_loaded_set[*other_row], &global[*other], &mut loaded)?;
            }
            at = end;
            let held = shards[shard].coverage;
            out.block_ordinal.push(ordinal);
            out.block_kind.push(held.block_kind[row]);
            out.block_owner.push(held.block_owner[row]);
            out.block_digest.push(dictionary.id(string(shard, held.block_digest[row])));
            out.block_name.push(dictionary.id(string(shard, held.block_name[row])));
            out.block_path.push(dictionary.id(string(shard, held.block_path[row])));
            out.block_start.push(held.block_start[row]);
            out.block_end.push(held.block_end[row]);
            out.block_source.push(held.block_source[row]);
            for members in [&mut called, &mut loaded] {
                members.sort_unstable();
                members.dedup();
            }
            crossings += called.len() as u64;
            out.block_set.push(sets.intern(&called));
            out.block_loaded_set.push(sets.intern(&loaded));
        }
    }
    out.module_blocks.push(out.block_ordinal.len() as u32);

    let modules = out.module_path.len() as u32;
    let commit = commit(0).map(str::to_owned);
    let columns = encoded(out, dictionary, instrumentation_id, commit_id, &sets);
    Ok(Folded { columns, tests: tests.len() as u32, modules, crossings, commit, files })
}

fn agree(first: &str, other: &str, what: &str, expected: &str, held: &str) -> Result<(), String> {
    if expected == held {
        return Ok(());
    }
    Err(format!(
        "{first} and {other} disagree about the {what} (`{expected}` against `{held}`), so they are not shards of one run and cannot be folded into one."
    ))
}

/// Whether two block rows describe one region: everything but who entered it.
fn region(shards: &[Shard<'_>], strings: &[Vec<&str>], (one, at): (usize, usize), (other, row): (usize, usize)) -> bool {
    let (left, right) = (shards[one].coverage, shards[other].coverage);
    let text = |coverage: &Coverage, shard: usize, column: fn(&Coverage) -> &Vec<u32>, row: usize| strings[shard][column(coverage)[row] as usize];
    left.block_kind[at] == right.block_kind[row]
        && left.block_owner[at] == right.block_owner[row]
        && left.block_start[at] == right.block_start[row]
        && left.block_end[at] == right.block_end[row]
        && left.block_source[at] == right.block_source[row]
        && text(left, one, |coverage| &coverage.block_digest, at) == text(right, other, |coverage| &coverage.block_digest, row)
        && text(left, one, |coverage| &coverage.block_name, at) == text(right, other, |coverage| &coverage.block_name, row)
        && text(left, one, |coverage| &coverage.block_path, at) == text(right, other, |coverage| &coverage.block_path, row)
}

/// The members of `set` in `coverage`'s pool, appended as the fold's test ids.
fn members(coverage: &Coverage, set: u32, global: &[u32], out: &mut Vec<u32>) -> Result<(), String> {
    let stored = case_shard::set_slice(&coverage.set_bytes, &coverage.set_offsets, set)?;
    for local in case_shard::decode_set(stored, coverage.tests())? {
        out.push(global[local as usize]);
    }
    Ok(())
}

fn encoded(out: Columns, dictionary: Dictionary<'_>, instrumentation: u32, commit: Option<u32>, sets: &SetPool) -> Vec<Column> {
    let (strings, rank) = dictionary.ranked();
    let ranked = |ids: Vec<u32>| -> Vec<u32> { ids.into_iter().map(|id| rank[id as usize]).collect() };
    let mut blob = Vec::new();
    let mut offsets = Vec::with_capacity(strings.len() + 1);
    offsets.push(0);
    for value in &strings {
        blob.extend_from_slice(value.as_bytes());
        offsets.push(blob.len() as u32);
    }
    let mut columns: FxHashMap<&str, Column> = FxHashMap::default();
    let name = |name: &str| -> &'static str {
        LAYOUT.coverage.sections.iter().find(|section| section.as_str() == name).map_or("", String::as_str)
    };
    let mut put = |column: Column| {
        let named = match &column {
            Column::Bytes(name, _) | Column::Words(name, _) | Column::Blob(name, _, _) | Column::Plain(name, _) => *name,
        };
        columns.insert(named, column);
    };
    put(Column::Blob(name("strings.blob"), blob, offsets.clone()));
    put(Column::Words(name("strings.off"), offsets));
    put(Column::Words(name("snapshot.instrumentation"), vec![rank[instrumentation as usize]]));
    put(Column::Words(name("snapshot.commit"), commit.map(|id| rank[id as usize]).into_iter().collect()));
    put(Column::Words(name("tests.path"), ranked(out.test_path)));
    put(Column::Bytes(name("tests.complete"), out.test_complete));
    put(Column::Words(name("tests.preconditions"), out.test_preconditions));
    put(Column::Words(name(&LAYOUT.coverage.duration), out.test_duration));
    put(Column::Words(name("preconditions.name"), ranked(out.precondition_name)));
    put(Column::Words(name("preconditions.digest"), ranked(out.precondition_digest)));
    put(Column::Words(name("modules.path"), ranked(out.module_path)));
    put(Column::Words(name("modules.source"), ranked(out.module_source)));
    put(Column::Bytes(name("modules.instrumented"), out.module_instrumented));
    put(Column::Words(name("modules.blocks"), out.module_blocks));
    put(Column::Words(name("blocks.ordinal"), out.block_ordinal));
    put(Column::Bytes(name("blocks.kind"), out.block_kind));
    put(Column::Words(name("blocks.owner"), out.block_owner));
    put(Column::Words(name("blocks.digest"), ranked(out.block_digest)));
    put(Column::Words(name("blocks.name"), ranked(out.block_name)));
    put(Column::Words(name("blocks.path"), ranked(out.block_path)));
    put(Column::Words(name("blocks.start"), out.block_start));
    put(Column::Words(name("blocks.end"), out.block_end));
    put(Column::Bytes(name("blocks.source"), out.block_source));
    put(Column::Words(name("blocks.set"), out.block_set));
    put(Column::Words(name("blocks.loadedSet"), out.block_loaded_set));
    put(Column::Blob(name("sets.blob"), sets.bytes().to_vec(), sets.offsets().to_vec()));
    put(Column::Words(name("sets.off"), sets.offsets().to_vec()));
    // The layout names every section once, and each is put above once.
    LAYOUT.coverage.sections.iter().filter_map(|section| columns.remove(section.as_str())).collect()
}

#[cfg(test)]
#[path = "record_coverage_fold_tests.rs"]
mod tests;
