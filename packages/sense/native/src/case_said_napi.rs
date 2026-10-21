//! What a case said and read, as TypeScript reaches it: every call speaks the
//! frame field's JSON, `{"said": [[name, value, site, level], …], "read": […], "misused": […]}`,
//! and does its work in [`crate::case_said`] (ADR-0094).

use std::path::Path;

use napi::bindgen_prelude::{Buffer, Uint32Array};
use napi_derive::napi;

use crate::case_said::{self, Heard};
use crate::crossing_sets::SetPool;

fn parsed(text: Option<&str>) -> napi::Result<Option<Heard>> {
    text.map(case_said::parse).transpose().map_err(napi::Error::from_reason)
}

/// What one case's frames or held rows heard, joined: `null` where none was
/// listened to. Each site is named from the checkout at `root` when given.
#[napi(catch_unwind)]
pub fn said_joined(root: Option<String>, said: Vec<Option<String>>) -> napi::Result<Option<String>> {
    let mut joined: Option<Heard> = None;
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

/// The row a reader prints for what a case said and read.
#[napi(catch_unwind)]
pub fn said_resolved(said: String) -> napi::Result<String> {
    let heard = case_said::parse(&said).map_err(napi::Error::from_reason)?;
    let joined = case_said::join(Some(heard), None).unwrap_or_default();
    Ok(case_said::spell(&case_said::resolve(&joined)))
}

/// A crossing-set pool, with the `tests.said`, `tests.read` and `tests.misused` sections laid into it.
#[napi(object)]
pub struct SaidLaid {
    pub said: Option<Buffer>,
    pub read: Option<Buffer>,
    pub misused: Option<Buffer>,
    pub bytes: Buffer,
    pub offsets: Uint32Array,
}

/// The `tests.said`, `tests.read` and `tests.misused` sections for what each case heard (`null` where it was never
/// listened to), its sets interned into the pool `bytes`/`offsets`.
#[napi(catch_unwind)]
pub fn said_laid(said: Vec<Option<String>>, bytes: Buffer, offsets: Uint32Array, test_count: u32) -> napi::Result<SaidLaid> {
    let items = said
        .iter()
        .map(|text| Ok(case_said::join(parsed(text.as_deref())?, None)))
        .collect::<napi::Result<Vec<Option<Heard>>>>()?;
    let mut pool =
        SetPool::from_pool(bytes.to_vec(), offsets.to_vec(), test_count as usize).map_err(napi::Error::from_reason)?;
    let views: Vec<Option<&Heard>> = items.iter().map(Option::as_ref).collect();
    let [said, read, misused] = case_said::lay(&views, &mut pool);
    Ok(SaidLaid {
        said: said.map(Buffer::from),
        read: read.map(Buffer::from),
        misused: misused.map(Buffer::from),
        bytes: pool.bytes().to_vec().into(),
        offsets: pool.offsets().to_vec().into(),
    })
}

/// What each of `test_count` cases heard off its `tests.said`, `tests.read` and
/// `tests.misused` sections, each absent, and their pool: `null` for a case no
/// recorder listened to.
#[napi(catch_unwind)]
pub fn said_read(
    said: Option<Buffer>,
    read: Option<Buffer>,
    misused: Option<Buffer>,
    bytes: Buffer,
    offsets: Uint32Array,
    test_count: u32,
) -> napi::Result<Vec<Option<String>>> {
    let pool =
        SetPool::from_pool(bytes.to_vec(), offsets.to_vec(), test_count as usize).map_err(napi::Error::from_reason)?;
    let sections = [said.as_deref(), read.as_deref(), misused.as_deref()];
    let heard = case_said::read(sections, test_count as usize, |set| pool.members(set)).map_err(napi::Error::from_reason)?;
    Ok(heard.into_iter().map(|heard| heard.map(|heard| case_said::spell(&heard))).collect())
}
