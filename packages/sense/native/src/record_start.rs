//! Where each shard of one build started, and the one rule over it: shards
//! that started apart fail the build, naming each shard and its start.
//!
//! A CI build combines the shards of one build, and every shard of it reads one
//! record before it runs. Six things say where a shard started, and every one
//! of them is heard here: the record its selection and its placement by time
//! read, and the record its run was laid over (the two sides of the `base`
//! part), the commit it ran at, the commit of the before layer its cases
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
/// It names no rerun: the record before the build stands, and running a suite
/// again is rarely the reader's to do.
pub(crate) fn unstable(first: &str, from_first: &str, second: &str, from_second: &str) -> String {
    format!(
        "the build failed because the sharding was unstable: {first} started from {from_first}, and {second} from {from_second}. \
         Each shard split the suite against the record it started from, so the split may have left tests that ran in no shard. \
         Nothing of this build is combined, so the record before it stands. \
         Shards start alike when every one restores the same cached record: \
         the `actions/cache` step keyed `variance-${{{{ runner.os }}}}-${{{{ runner.arch }}}}-${{{{ github.sha }}}}` restores it, \
         and a shard that restored another, or none, starts apart."
    )
}

/// The failure of a run whose shards chose their tests from different
/// records: the selection, or the times a shard is placed by, read another
/// record in each, so each shard cut the suite against another plan. Names
/// both shards and the record each read.
fn split_apart(first: &str, read_first: &str, second: &str, read_second: &str) -> String {
    format!(
        "the build failed because the sharding was unstable: {first} chose its tests from {read_first}, and {second} from {read_second}. \
         Each shard chose its tests, and placed them by time, from the record it read, so the split may have left tests that ran in no shard. \
         Nothing of this build is combined, so the record before it stands. \
         Shards choose alike when every one reads the same record: \
         a shard reads this checkout's record, which the `actions/cache` step keyed `variance-${{{{ runner.os }}}}-${{{{ runner.arch }}}}-${{{{ github.sha }}}}` restores, \
         or else the mainline's from the share, and a shard that restored another, or none, or read a mainline record published while the others started, reads apart."
    )
}

/// What a record's run started from, either side: `none`, or a `sha256:` digest.
const NO_BASE: &str = "none";

/// The read side of a run that cannot name the record its selection read: the
/// JVM agent never sees the selection it runs under. Combining checks no read
/// of such a shard, and says so.
const UNKNOWN: &str = "unknown";

/// Between the record a run read and the record it was laid over, in a spelled base.
const OVER: &str = " over ";

/// Where a run started: the record its selection and placement read, and the
/// record it was laid over, each `none` or a `sha256:` digest.
#[derive(Clone, PartialEq, Eq)]
struct Start {
    read: String,
    laid: String,
}

impl Start {
    /// As the record spells it: one record when the two are one, `none` above all.
    fn spelled(&self) -> String {
        if self.read == self.laid { self.read.clone() } else { format!("{}{OVER}{}", self.read, self.laid) }
    }
}

/// The message for shards written before records named their start, or `None`
/// when every shard names one. `unnamed` holds, for each shard in the order
/// combined, whether its record holds no `base` part. Shards of 0.15.0 and
/// earlier name none; a run of a later version always names one.
pub(crate) fn versions_apart(shards: &[(&str, bool)]) -> Option<String> {
    let (old, new): (Vec<_>, Vec<_>) = shards.iter().partition(|(_, unnamed)| *unnamed);
    let (old, new): (Vec<&str>, Vec<&str>) = (old.iter().map(|(shard, _)| *shard).collect(), new.iter().map(|(shard, _)| *shard).collect());
    if old.is_empty() {
        return None;
    }
    let later = if new.is_empty() { String::new() } else { format!(", and {} by a later version", new.join(", ")) };
    Some(format!(
        "{} {} written by variance-authority 0.15.0 or earlier{later}: such a record names no record its run started from, so nothing says the shards split one plan, and they are not combined. \
         Shards combine when the version that combines them wrote every one.",
        old.join(", "),
        if old.len() == 1 { "was" } else { "were" }
    ))
}

/// What a record's `base` part says its run started from: one side, `none` or
/// a `sha256:` digest, when the record it read is the one it was laid over;
/// otherwise `<read> over <laid>`, where the read may be `unknown`. A record
/// that holds no part was written before the part, and is refused.
fn base(shard: &str, part: Option<&[u8]>) -> Result<Start, String> {
    let Some(part) = part else {
        return Err(versions_apart(&[(shard, true)]).unwrap_or_default());
    };
    let text = std::str::from_utf8(part).unwrap_or_default();
    let side = |side: &str| {
        let digest = side.strip_prefix("sha256:").is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()));
        (side == NO_BASE || digest).then(|| side.to_owned())
    };
    let read = |read: &str| if read == UNKNOWN { Some(UNKNOWN.to_owned()) } else { side(read) };
    let start = match text.split_once(OVER) {
        Some((chose, laid)) => read(chose).zip(side(laid)).map(|(read, laid)| Start { read, laid }),
        None => side(text).map(|one| Start { read: one.clone(), laid: one }),
    };
    start.ok_or_else(|| {
        format!(
            "{shard} names the record it started from as `{}`, which is neither `none`, a sha256 digest, nor two of them joined by `over`, the first of which may be `unknown`, so this build cannot tell where it started, and nothing of it is combined.",
            String::from_utf8_lossy(part)
        )
    })
}

/// A base as a failure names it: its digest's first twelve digits are enough to tell two apart.
fn named_base(base: &str) -> String {
    if base == NO_BASE {
        return "no record".to_owned();
    }
    format!("the record {}", &base[..base.len().min("sha256:".len() + 12)])
}

/// What the shards of one combine say of their start: the record each read and
/// the record each was laid over, the first shard to name each; the shards
/// whose read is `unknown`; the commit of the coverage each measured, and the
/// commit each ran at.
pub(crate) struct Starts {
    read: Option<(String, String)>,
    laid: Option<(String, String)>,
    unchecked: Vec<String>,
    measured: Agreed,
    commit: Agreed,
}

impl Starts {
    pub fn new() -> Self {
        Starts { read: None, laid: None, unchecked: Vec::new(), measured: Agreed::start("commit"), commit: Agreed::start("commit") }
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
        match &self.read {
            _ if base.read == UNKNOWN => self.unchecked.push(shard.to_owned()),
            None => self.read = Some((shard.to_owned(), base.read)),
            Some((first, held)) if *held != base.read => return Err(split_apart(first, &named_base(held), shard, &named_base(&base.read))),
            Some(_) => {}
        }
        match &self.laid {
            None => self.laid = Some((shard.to_owned(), base.laid)),
            Some((first, held)) if *held != base.laid => return Err(unstable(first, &named_base(held), shard, &named_base(&base.laid))),
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

    /// The record every shard started from, spelled as a record names it.
    pub fn base(&self) -> Option<String> {
        let (_, laid) = self.laid.as_ref()?;
        Some(Start { read: self.read().unwrap_or(UNKNOWN).to_owned(), laid: laid.clone() }.spelled())
    }

    /// The record every shard read; `unknown` when any shard could not name
    /// it, since nothing checked that one read what the others did.
    pub fn read(&self) -> Option<&str> {
        self.laid.as_ref()?;
        match &self.read {
            Some((_, read)) if self.unchecked.is_empty() => Some(read),
            _ => Some(UNKNOWN),
        }
    }

    /// The shards whose read was not checked, in the order heard.
    pub fn unchecked(&self) -> &[String] {
        &self.unchecked
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
