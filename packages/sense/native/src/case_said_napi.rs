//! What a case said, as TypeScript reaches it: every call speaks the frame
//! field's JSON, `[[name, value, site, level], …]`, and does its work in
//! [`crate::case_said`] (ADR-0094).

use std::path::Path;

use napi::bindgen_prelude::{Buffer, Uint32Array};
use napi_derive::napi;

use crate::case_said::{self, Said};
use crate::journey_format::SetPool;

fn parsed(text: Option<&str>) -> napi::Result<Option<Said>> {
    text.map(case_said::parse).transpose().map_err(napi::Error::from_reason)
}

/// What one case's frames or held rows said, joined: `null` where none was
/// listened to. Each site is named from the checkout at `root` when given.
#[napi(catch_unwind)]
pub fn said_joined(root: Option<String>, said: Vec<Option<String>>) -> napi::Result<Option<String>> {
    let mut joined: Option<Said> = None;
    for text in &said {
        let items = parsed(text.as_deref())?;
        let items = match (&root, items) {
            (Some(root), Some(items)) => Some(case_said::heard(Path::new(root), items)),
            (_, items) => items,
        };
        joined = case_said::join(joined, items);
    }
    Ok(joined.map(|said| case_said::spell(&said)))
}

/// A call site named from the checkout at `root`, as every row names it.
#[napi]
pub fn said_site(root: String, site: String) -> String {
    case_said::checkout_site(Path::new(&root), &site)
}

/// The row a reader prints for what a case said.
#[napi(catch_unwind)]
pub fn said_resolved(said: String) -> napi::Result<String> {
    let items = case_said::parse(&said).map_err(napi::Error::from_reason)?;
    let joined = case_said::join(Some(items), None).unwrap_or_default();
    Ok(case_said::spell(&case_said::resolve(&joined)))
}

/// A crossing-set pool, with the `tests.said` section laid into it.
#[napi(object)]
pub struct SaidLaid {
    pub section: Option<Buffer>,
    pub bytes: Buffer,
    pub offsets: Uint32Array,
}

/// The `tests.said` section for each case's `said` (`null` where it was never
/// listened to), its sets interned into the pool `bytes`/`offsets`.
#[napi(catch_unwind)]
pub fn said_laid(said: Vec<Option<String>>, bytes: Buffer, offsets: Uint32Array, test_count: u32) -> napi::Result<SaidLaid> {
    let items = said
        .iter()
        .map(|text| Ok(case_said::join(parsed(text.as_deref())?, None)))
        .collect::<napi::Result<Vec<Option<Said>>>>()?;
    let mut pool =
        SetPool::from_pool(bytes.to_vec(), offsets.to_vec(), test_count as usize).map_err(napi::Error::from_reason)?;
    let views: Vec<Option<&[case_said::Item]>> = items.iter().map(Option::as_deref).collect();
    let section = case_said::lay(&views, &mut pool).map(Buffer::from);
    Ok(SaidLaid { section, bytes: pool.bytes().to_vec().into(), offsets: pool.offsets().to_vec().into() })
}

/// What each of `test_count` cases said off a `tests.said` section and its
/// pool: `null` for a case no recorder listened to.
#[napi(catch_unwind)]
pub fn said_read(section: Buffer, bytes: Buffer, offsets: Uint32Array, test_count: u32) -> napi::Result<Vec<Option<String>>> {
    let pool =
        SetPool::from_pool(bytes.to_vec(), offsets.to_vec(), test_count as usize).map_err(napi::Error::from_reason)?;
    let said = case_said::read(&section, test_count as usize, |set| pool.members(set)).map_err(napi::Error::from_reason)?;
    Ok(said.into_iter().map(|said| said.map(|said| case_said::spell(&said))).collect())
}
