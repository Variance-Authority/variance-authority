//! Asking the prepared journeys about some of the cases rather than about a
//! file: every call those cases placed, counted among them. A question that
//! kept fifteen of fifty tests is answered by the fifteen, so a call only the
//! other thirty-five placed is not on its map and a call all fifteen placed is
//! not diluted by the ones that were dropped. Nothing is truncated: the caller
//! chose the cases, and the calls they placed are the whole answer.

// compass: variance-authority.reach.relations

use napi_derive::napi;

use crate::journey_stitch::strings;
use crate::journeys::TEST;
use crate::journeys_read::opened;
use crate::journeys_steps::{Known, Tag};

/// A function at one end of a placed call.
#[napi(object)]
pub struct JourneysPlace {
    pub name: String,
    pub file: String,
    pub line: u32,
    pub end: u32,
}

#[napi(object)]
pub struct JourneysPlaced {
    /// Absent when the test itself made the call.
    pub from: Option<JourneysPlace>,
    pub to: JourneysPlace,
    /// Asked cases that placed it.
    pub cases: u32,
    /// Every case that placed it, asked or not.
    pub all: u32,
    /// `observed`, `static`, a way it was inferred, or `test`.
    pub known: String,
}

#[napi(object)]
pub struct JourneysAmong {
    /// Why the prepared file cannot answer; every other field is empty then.
    pub not_prepared: Option<String>,
    /// Cases the recording holds.
    pub cases: u32,
    /// Asked cases the recording does not hold.
    pub outside: Vec<u32>,
    pub commit: Option<String>,
    pub tree: Option<String>,
    /// Most asked cases first, then in the order the file keeps them.
    pub calls: Vec<JourneysPlaced>,
}

fn refused(reason: &str) -> JourneysAmong {
    JourneysAmong { not_prepared: Some(reason.to_owned()), cases: 0, outside: Vec::new(), commit: None, tree: None, calls: Vec::new() }
}

/// Every call the cases numbered `cases` placed, as the journeys prepared at
/// `out` hold it. A case is numbered by its position in the recording.
#[napi(catch_unwind)]
pub fn journeys_among(index: String, recording: String, out: String, cases: Vec<u32>) -> JourneysAmong {
    let (meta, decoded) = match opened(&index, &recording, &out) {
        Ok(opened) => opened,
        Err(reason) => return refused(reason),
    };
    match placed(&decoded, meta.cases, &cases) {
        Ok((calls, outside)) => JourneysAmong { not_prepared: None, cases: meta.cases, outside, commit: meta.commit, tree: meta.tree, calls },
        Err(error) => refused(&format!("they did not read ({error})")),
    }
}

fn placed(decoded: &crate::journey_columns::Decoded, held: u32, cases: &[u32]) -> Result<(Vec<JourneysPlaced>, Vec<u32>), String> {
    let mut asked = vec![false; held as usize];
    let mut outside = Vec::new();
    for &case in cases {
        match asked.get_mut(case as usize) {
            Some(slot) => *slot = true,
            None => outside.push(case),
        }
    }
    let text = strings(decoded)?;
    let region_file = decoded.words("regions.file")?;
    let region_name = decoded.words("regions.name")?;
    let region_start = decoded.words("regions.start")?;
    let region_end = decoded.words("regions.end")?;
    let from = decoded.words("calls.from")?;
    let to = decoded.words("calls.to")?;
    let tag = decoded.bytes("calls.tag")?;
    let how = decoded.bytes("calls.how")?;
    let who = decoded.words("calls.who")?;
    let off = decoded.words("calls.who.off")?;
    let string = |id: u32| text.get(id as usize).cloned().unwrap_or_default();
    let place = |region: u32| {
        let at = region as usize;
        JourneysPlace { name: string(region_name[at]), file: string(region_file[at]), line: region_start[at], end: region_end[at] }
    };
    let mut counted: Vec<(usize, u32)> = (0..to.len())
        .map(|call| {
            let placers = &who[off[call] as usize..off[call + 1] as usize];
            (call, placers.iter().filter(|&&case| asked.get(case as usize).copied().unwrap_or(false)).count() as u32)
        })
        .filter(|&(_, among)| among > 0)
        .collect();
    counted.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let calls = counted
        .into_iter()
        .map(|(call, among)| JourneysPlaced {
            from: (from[call] != TEST).then(|| place(from[call])),
            to: place(to[call]),
            cases: among,
            all: off[call + 1] - off[call],
            known: match Tag::from_code(tag[call]) {
                Some(Tag::Inferred) => Known::from_code(how[call]).map_or("inferred", Known::name).to_owned(),
                Some(tag) => tag.name().to_owned(),
                None => "unknown".to_owned(),
            },
        })
        .collect();
    Ok((calls, outside))
}
