//! Rust module facts retained only across the frontiers of one source scan.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

#[derive(Default)]
pub(crate) struct State {
    binding: Option<(String, u32, bool, Arc<HashMap<String, u32>>)>,
    pub parses: Option<Buffer>,
    #[cfg(feature = "grammars")]
    pub rust: std::sync::OnceLock<Arc<crate::rust_resolve::RustWorld>>,
    pub prefetched: std::cell::RefCell<HashMap<String, (crate::acquire::Answer, crate::batch::Acquired)>>,
    pub preparations_handed: std::cell::Cell<bool>,
}

pub(crate) struct PreparedParse<'a> {
    pub file: &'a str,
    pub identity: String,
    pub read: &'a crate::source_read::SourceRead,
    pub kept: bool,
}

/// Unconsumed preparation reads use the same content identity as closure rows.
pub(crate) fn prepared_parses<'a>(
    prefetched: &'a HashMap<String, (crate::acquire::Answer, crate::batch::Acquired)>,
    identities: Option<&HashMap<String, String>>,
) -> Vec<PreparedParse<'a>> {
    prefetched.iter().filter_map(|(file, ((read, _, outcome), acquired))| {
        if !outcome.parsed() { return None }
        let identity = identities.and_then(|known| known.get(file)).cloned()
            .unwrap_or_else(|| acquired.identity.clone());
        (!identity.is_empty()).then_some(PreparedParse { file, identity, read, kept: acquired.kept })
    }).collect()
}

#[napi]
pub struct ScanSession {
    state: Mutex<State>,
}

/// A fresh scan owns this context; another scan must create another one.
#[napi(catch_unwind)]
pub fn new_scan_session(parses: Option<Buffer>) -> ScanSession {
    ScanSession { state: Mutex::new(State { parses, ..State::default() }) }
}

impl ScanSession {
    pub(crate) fn hold(&self, root: &str, largest: Option<u32>, packs: Option<bool>, at: &Arc<HashMap<String, u32>>) -> napi::Result<MutexGuard<'_, State>> {
        let mut state = self.state.lock().map_err(|_| napi::Error::from_reason("the native scan session was interrupted"))?;
        let largest = largest.unwrap_or(crate::acquire::LARGEST_FILE);
        let packs = packs != Some(false);
        if let Some((held_root, held_largest, held_packs, held_at)) = &state.binding {
            if held_root != root || *held_largest != largest || *held_packs != packs || !Arc::ptr_eq(held_at, at) {
                return Err(napi::Error::from_reason("a native scan session belongs to one root, file tree, size limit and acquisition mode"));
            }
        } else {
            state.binding = Some((root.to_owned(), largest, packs, Arc::clone(at)));
        }
        Ok(state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_refuses_a_different_snapshot_or_reading_contract() {
        let session = new_scan_session(None);
        let at = Arc::new(HashMap::new());
        assert!(session.hold("/root", None, None, &at).is_ok());
        assert!(session.hold("/root", Some(crate::acquire::LARGEST_FILE), Some(true), &at).is_ok());
        assert!(session.hold("/other", None, None, &at).is_err());
        assert!(session.hold("/root", Some(1), None, &at).is_err());
        assert!(session.hold("/root", None, Some(false), &at).is_err());
        assert!(session.hold("/root", None, None, &Arc::new(HashMap::new())).is_err());
    }
}
