//! One classification and opening of a source generation, shared by writers and readers.
// compass: variance-authority.reach.source-index

use rayon::prelude::*;
use crate::compact::Layer;

pub(crate) struct OpenedLayers<'a> {
    pub layers: Vec<Layer<'a>>,
    pub state: &'static str,
    pub written: Option<u32>,
    pub error: Option<String>,
}

/// Keep the valid prefix, classifying the first unread segment from the bytes already read.
pub(crate) fn open(segments: &[Vec<u8>], damaged: bool) -> OpenedLayers<'_> {
    let mut held = OpenedLayers { layers: Vec::new(), state: if damaged { "damaged" } else { "published" }, written: None,
        error: damaged.then(|| "the committed chain has a missing or truncated segment".to_owned()) };
    let opened: Vec<_> = segments.par_iter().map(|bytes|
        std::panic::catch_unwind(|| Layer::open(bytes)).unwrap_or_else(|_| Err("the source segment is malformed".into()))).collect();
    for (at, (bytes, opened)) in segments.iter().zip(opened).enumerate() {
        match opened {
            Ok(layer) => held.layers.push(layer),
            Err(error) => {
                held.written = other_version(bytes);
                held.state = if held.written.is_some() { "other-version" } else { "damaged" };
                held.error = Some(format!("segment {at}: {error}"));
                break;
            }
        }
    }
    held
}

/// A foreign source-index header is a version mismatch, not generic damage.
fn other_version(bytes: &[u8]) -> Option<u32> {
    #[derive(serde::Deserialize)]
    struct Header { format: String, version: u32 }
    let length = u32::from_le_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
    let text = std::str::from_utf8(bytes.get(4..4usize.checked_add(length)?)?).ok()?;
    let header: Header = serde_json::from_str(text.trim_end_matches('\0')).ok()?;
    (header.format == crate::segment::FORMAT && header.version != u32::from(crate::segment::VERSION)).then_some(header.version)
}
