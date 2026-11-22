//! The case readings lay and reader as TypeScript reaches them: buffers in and
//! out, the work done in [`super`].

use std::collections::{HashMap, HashSet};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use super::{lay, open, readings_of, Announced, Region, Run};

/// Lay a run's case readings over the record's; see `layReadings`. `same` is
/// every file the run recorded from the text the landed index holds it at,
/// and `inputs` each test file's inputs as `[file, digest]`.
#[napi(catch_unwind)]
#[allow(clippy::too_many_arguments)]
pub fn lay_readings(
    kept: Option<Buffer>,
    previous: Option<Buffer>,
    landed: Option<Buffer>,
    cases: Vec<String>,
    fresh: Option<Buffer>,
    announced: Vec<String>,
    same: Vec<String>,
    inputs: Option<Vec<Vec<String>>>,
) -> napi::Result<Option<Buffer>> {
    let inputs = inputs
        .map(|pairs| pairs.into_iter().map(|pair| match <[String; 2]>::try_from(pair) {
            Ok([file, digest]) => Ok((file, digest)),
            Err(_) => Err(napi::Error::from_reason("an input is a file and its digest")),
        }).collect::<napi::Result<HashMap<_, _>>>())
        .transpose()?;
    let run = fresh.as_deref().map(|fresh| Run { fresh, announced: Announced::Cases(announced.into_iter().collect()), same: same.into_iter().collect(), inputs });
    let cases: HashSet<String> = cases.into_iter().collect();
    lay(kept.as_deref(), previous.as_deref(), landed.as_deref(), &cases, run.as_ref()).map(|bytes| bytes.map(Buffer::from)).map_err(napi::Error::from_reason)
}

/// One recorded run of one case, as `Reading` names it.
#[napi(object)]
pub struct CaseReading {
    pub count: f64,
    pub stopped: Option<bool>,
    pub regions: Vec<CaseRegion>,
}

/// One region a reading crossed, as `ReadRegion` names it.
#[napi(object)]
pub struct CaseRegion {
    pub module: String,
    pub name: String,
    pub path: String,
    pub start: f64,
    pub end: f64,
    pub value: Option<f64>,
}

/// The readings of case `id`; see `readingsOf`.
#[napi(catch_unwind)]
pub fn readings_of_case(section: Buffer, index: Option<Buffer>, id: String) -> napi::Result<Option<Vec<CaseReading>>> {
    readings_of(&section, index.as_deref(), &id, |reading| CaseReading {
        count: reading.count as f64,
        stopped: reading.stopped,
        regions: reading.regions.into_iter().map(region).collect(),
    })
    .map_err(napi::Error::from_reason)
}

/// The regions case `id` crossed as `index` holds its newest run; see `newestRegions`.
#[napi(catch_unwind)]
pub fn newest_regions_of_case(index: Buffer, id: String) -> napi::Result<Option<Vec<CaseRegion>>> {
    let Some(index) = open(&index).map_err(napi::Error::from_reason)? else { return Ok(None) };
    let read = index.reads(&HashSet::from([id.as_str()])).map_err(napi::Error::from_reason)?.remove(&id);
    Ok(read.map(|read| read.regions.into_iter().map(region).collect()))
}

fn region(region: Region<'_>) -> CaseRegion {
    CaseRegion {
        module: region.module.to_string(),
        name: region.name.to_string(),
        path: region.path.to_string(),
        start: region.start as f64,
        end: region.end as f64,
        value: region.value.map(|value| value as f64),
    }
}
