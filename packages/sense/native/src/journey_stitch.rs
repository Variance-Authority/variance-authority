use std::collections::HashMap;
use std::fs;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::case_fold::{self, Folded};
use crate::case_shard;
use crate::journey_output;

#[napi(object)]
pub struct JourneyStitch {
    pub bytes: Buffer,
    pub tests: u32,
    pub modules: u32,
    pub crossings: f64,
    pub shards: u32,
    /// Files two shards numbered differently, read at the regions both hold.
    pub renumbered: Vec<String>,
    /// Modules a case ran that no record holds, over every shard; absent when
    /// a shard was finalized without carrying them.
    pub unrecorded: Option<Vec<String>>,
    /// Part files that ran code under no journey a case handed out, over every shard.
    pub unclaimed: Option<Vec<String>>,
    /// Heads that wrote parts in a run before and none in this one, over every shard.
    pub silent: Option<Vec<String>>,
}

#[napi(object)]
pub struct JourneyStitchResult {
    pub tests: u32,
    pub modules: u32,
    pub crossings: f64,
    pub shards: u32,
    /// Files two shards numbered differently, read at the regions both hold.
    pub renumbered: Vec<String>,
    /// Modules a case ran that no record holds, over every shard; absent when
    /// a shard was finalized without carrying them.
    pub unrecorded: Option<Vec<String>>,
    /// Part files that ran code under no journey a case handed out, over every shard.
    pub unclaimed: Option<Vec<String>>,
    /// Heads that wrote parts in a run before and none in this one, over every shard.
    pub silent: Option<Vec<String>>,
}

/// Every artifact in `files` read and folded through the one case fold.
fn stitch(files: &[String]) -> Result<(Folded, u32), String> {
    if files.is_empty() {
        return Err("no journey artifacts were named".to_owned());
    }
    let mut shards = Vec::with_capacity(files.len());
    let mut inventories = HashMap::new();
    for file in files {
        let bytes = fs::read(file).map_err(|error| format!("cannot read {file}: {error}"))?;
        let shard = case_shard::read_shard(&bytes, &mut inventories)
            .map(|shard| case_shard::Shard { name: file.clone(), ..shard })
            .map_err(|error| format!("cannot read journey artifact {file}: {error}"))?;
        shards.push(shard);
    }
    let folded = case_fold::fold(shards, inventories, false).map_err(|error| format!("cannot stitch journey artifacts: {error}"))?;
    Ok((folded, files.len() as u32))
}

/// Union journey-only execution artifacts without materializing one object per crossing.
#[napi(catch_unwind)]
pub fn stitch_journeys(files: Vec<String>) -> napi::Result<JourneyStitch> {
    let (answered, shards) = stitch(&files).map_err(napi::Error::from_reason)?;
    Ok(JourneyStitch {
        bytes: answered.bytes.into(),
        tests: answered.tests,
        modules: answered.modules,
        crossings: answered.crossings as f64,
        shards,
        renumbered: answered.renumbered,
        unrecorded: answered.gaps.as_ref().map(|gaps| gaps.unrecorded.clone()),
        unclaimed: answered.gaps.as_ref().map(|gaps| gaps.unclaimed.clone()),
        silent: answered.gaps.and_then(|gaps| gaps.silent),
    })
}

/// Stitch and write the compressed artifact without transferring it through V8.
#[napi(catch_unwind)]
pub fn stitch_journeys_to(files: Vec<String>, output: String) -> napi::Result<JourneyStitchResult> {
    let (answered, shards) = stitch(&files).map_err(napi::Error::from_reason)?;
    journey_output::replace(&output, &answered.bytes).map_err(napi::Error::from_reason)?;
    Ok(JourneyStitchResult {
        tests: answered.tests,
        modules: answered.modules,
        crossings: answered.crossings as f64,
        shards,
        renumbered: answered.renumbered,
        unrecorded: answered.gaps.as_ref().map(|gaps| gaps.unrecorded.clone()),
        unclaimed: answered.gaps.as_ref().map(|gaps| gaps.unclaimed.clone()),
        silent: answered.gaps.and_then(|gaps| gaps.silent),
    })
}
