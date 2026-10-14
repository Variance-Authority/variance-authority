//! Where each shard of one build started, and the one rule over it: shards
//! that started apart fail the build, naming each shard and its start.
//!
//! A CI build combines the shards of one build, and every shard of it restores
//! one cached record before it runs. Five things say where a shard started,
//! and every one of them is heard here: the record its run was laid over (the
//! `base` part), the commit it ran at, the commit of the before layer its cases
//! were laid over, whether it began over no case index at all, and the text of
//! each module its cases stood on before it. Two shards that say two of any
//! started from two records, so each split the suite against another plan.

use std::collections::BTreeMap;

/// What every shard of one run says alike, and the first shard that said it.
/// Heard by `hear`, absent is a value: a shard that names none disagrees with
/// one that names one. Heard by `hear_some`, absent says nothing.
///
/// Shards that disagree about how they were made, the instrumentation, are
/// refused: they are not shards of one run. Shards that disagree about where
/// they started, `Agreed::start`, fail the build as [`unstable`]: they are one
/// run whose split moved under it.
pub(crate) struct Agreed {
    what: &'static str,
    held: Option<(String, Option<String>)>,
    start: bool,
}

/// The failure of a run whose shards started from different records: the
/// cached base was replaced while they ran, so each shard split the suite
/// against another plan. Names both shards and the record each started from,
/// and the cache step that restores one record to every shard (`docs/cache.md`).
pub(crate) fn unstable(first: &str, from_first: &str, second: &str, from_second: &str) -> String {
    format!(
        "the build failed because the sharding was unstable: {first} started from {from_first}, and {second} from {from_second}. \
         Each shard split the suite against the record it started from, so the split may have left tests that ran in no shard. \
         Run the whole build again, so that every shard restores the same cached record: \
         the `actions/cache` step keyed `variance-${{{{ runner.os }}}}-${{{{ runner.arch }}}}-${{{{ github.sha }}}}` restores it, \
         and a shard that restored another, or none, starts apart again."
    )
}

/// The base a record names when its run was laid over no record.
const NO_BASE: &str = "none";

/// What a record's `base` part says its run started from: `none`, or the
/// `sha256:` digest of the record it was laid over. A record that holds none
/// was written by a build before the part, or by a writer that is not a run,
/// and is refused: nothing says where it started.
fn base(shard: &str, part: Option<&[u8]>) -> Result<String, String> {
    let Some(part) = part else {
        return Err(format!(
            "{shard} names no record its run started from: it was written before records named one (0.15.0 or earlier), or not by a run. Record it again with this build."
        ));
    };
    let text = std::str::from_utf8(part).unwrap_or_default();
    let digest = text.strip_prefix("sha256:").is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()));
    if text == NO_BASE || digest {
        return Ok(text.to_owned());
    }
    Err(format!("{shard} names the record it started from as `{}`, which is neither `none` nor a sha256 digest. Record it again with this build.", String::from_utf8_lossy(part)))
}

/// A base as a failure names it: its digest's first twelve digits are enough to tell two apart.
fn named_base(base: &str) -> String {
    if base == NO_BASE {
        return "no record".to_owned();
    }
    format!("the record {}", &base[..base.len().min("sha256:".len() + 12)])
}

/// What the shards of one combine say of their start: the record each was laid
/// over, the commit of the coverage each measured, and the commit each ran at.
pub(crate) struct Starts {
    base: Option<(String, String)>,
    measured: Agreed,
    commit: Agreed,
}

impl Starts {
    pub fn new() -> Self {
        Starts { base: None, measured: Agreed::start("commit"), commit: Agreed::start("commit") }
    }

    /// `shard`'s start: the `base` part it holds; `covered`, the commit of its
    /// coverage, `None` when it measured none; and `last`, the commit its
    /// last-run layer names. A shard that observed nothing names no commit, but
    /// it split the suite by its base like any other.
    ///
    /// Coverage measured at no commit is a value among the measured shards. A
    /// shard that measured nothing speaks for the commit through its last run,
    /// and one whose last run names no commit disagrees with nobody. A measured
    /// shard's last run may name a later commit than its coverage, when a run
    /// that instrumented nothing was laid over it.
    pub fn hear(&mut self, shard: &str, part: Option<&[u8]>, covered: Option<Option<&str>>, last: Option<&str>, empty: bool) -> Result<(), String> {
        let base = base(shard, part)?;
        match &self.base {
            None => self.base = Some((shard.to_owned(), base)),
            Some((first, held)) if *held != base => return Err(unstable(first, &named_base(held), shard, &named_base(&base))),
            Some(_) => {}
        }
        if empty {
            return Ok(());
        }
        match covered {
            Some(named) => {
                self.measured.hear(shard, named)?;
                self.commit.hear_some(shard, named)
            }
            None => self.commit.hear_some(shard, last),
        }
    }

    /// The record every shard started from.
    pub fn base(&self) -> Option<&str> {
        self.base.as_ref().map(|(_, base)| base.as_str())
    }

    /// The commit of the coverage every measured shard holds.
    pub fn measured(&self) -> Option<&str> {
        self.measured.value()
    }

    /// The commit every shard ran at.
    pub fn commit(&self) -> Option<&str> {
        self.commit.value()
    }
}

/// What one shard's last-run layer says of its start.
pub(crate) struct LastStart<'a> {
    pub shard: &'a str,
    pub commit: Option<&'a str>,
    /// The commit of the before layer; none for a shard that began over no index.
    pub before: Option<&'a str>,
    pub began: bool,
    pub texts: Option<&'a BTreeMap<String, String>>,
}

/// The start every shard's last-run layer agrees on.
pub(crate) struct LastStarted {
    pub commit: Option<String>,
    pub before: Option<String>,
    pub began: bool,
    pub texts: BTreeMap<String, String>,
}

/// The shards' last-run layers' starts as one. They ran at one commit over one
/// before layer; they began over no index when every shard did, and a shard
/// that began over none beside one that began over a record split the suite
/// against another plan. Shards that ran at two commits, over two before
/// layers, or over two texts of one module started from different records.
/// Each of those fails as [`unstable`].
pub(crate) fn last_started(shards: &[LastStart]) -> Result<LastStarted, String> {
    let Some(held) = shards.first() else {
        return Err("folding last-run layers needs at least one".to_owned());
    };
    let (mut commit, mut before) = (Agreed::start("commit"), Agreed::start("the before layer of commit"));
    for shard in shards {
        commit.hear_some(shard.shard, shard.commit)?;
        // A shard that began over no record names no before commit.
        before.hear_some(shard.shard, shard.before)?;
    }
    if let Some(other) = shards.iter().find(|shard| shard.began != held.began) {
        let start = |shard: &LastStart| match (shard.began, shard.before) {
            (true, _) => "no record".to_owned(),
            (false, Some(before)) => format!("the before layer of commit `{before}`"),
            (false, None) => "a record".to_owned(),
        };
        return Err(unstable(held.shard, &start(held), other.shard, &start(other)));
    }
    let mut texts: BTreeMap<String, (String, &str)> = BTreeMap::new();
    for shard in shards {
        for (file, text) in shard.texts.into_iter().flatten() {
            match texts.get(file) {
                Some((held, by)) if held != text => {
                    return Err(unstable(by, &format!("`{file}` at text `{held}`"), shard.shard, &format!("`{file}` at text `{text}`")));
                }
                Some(_) => {}
                None => {
                    texts.insert(file.clone(), (text.clone(), shard.shard));
                }
            }
        }
    }
    Ok(LastStarted {
        commit: commit.value().map(str::to_owned),
        before: before.value().map(str::to_owned),
        began: held.began,
        texts: texts.into_iter().map(|(file, (text, _))| (file, text)).collect(),
    })
}

impl Agreed {
    pub fn new(what: &'static str) -> Self {
        Agreed { what, held: None, start: false }
    }

    /// What every shard started from: shards that name two fail as [`unstable`].
    pub fn start(what: &'static str) -> Self {
        Agreed { what, held: None, start: true }
    }

    /// `shard` says `value`; shards are heard in code-unit order of their names.
    pub fn hear(&mut self, shard: &str, value: Option<&str>) -> Result<(), String> {
        match &self.held {
            None => {
                self.held = Some((shard.to_owned(), value.map(str::to_owned)));
                Ok(())
            }
            Some((_, held)) if held.as_deref() == value => Ok(()),
            Some((first, held)) if self.start => {
                let named = |value: Option<&str>| value.map_or_else(|| format!("no {}", self.what), |value| format!("{} `{value}`", self.what));
                Err(unstable(first, &named(held.as_deref()), shard, &named(value)))
            }
            Some((first, held)) => Err(format!(
                "{first} and {shard} disagree about the {} (`{}` against `{}`), so they are not shards of one run and cannot be folded into one.",
                self.what,
                held.as_deref().unwrap_or("(none)"),
                value.unwrap_or("(none)")
            )),
        }
    }

    /// `shard` says `value`, or says nothing when it names none: a shard that
    /// names no commit disagrees with nobody.
    pub fn hear_some(&mut self, shard: &str, value: Option<&str>) -> Result<(), String> {
        value.map_or(Ok(()), |value| self.hear(shard, Some(value)))
    }

    /// The value every shard heard said, if any said one.
    pub fn value(&self) -> Option<&str> {
        self.held.as_ref().and_then(|(_, value)| value.as_deref())
    }
}

#[cfg(test)]
#[path = "record_start_tests.rs"]
mod tests;
