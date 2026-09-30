//! Every package's layer and closure, read from the code map kept beside the
//! index (`orient_map.rs`) for `variance layers`.

// compass: variance-authority.reach.relations

use napi_derive::napi;

use crate::orient_map::{kept_bytes, manifest_digest, map_path, Stored};

/// One package's place in the dependency layers of a kept map.
#[napi(object)]
pub struct OrientPackageLayer {
    pub package: String,
    pub directory: String,
    /// One more than the highest layer among the packages it takes; a package
    /// that takes nothing is layer 1.
    pub layer: u32,
    /// The packages it imports from, in code-unit order.
    pub takes: Vec<String>,
    /// Effective lines over every sized file its shipped files load, through
    /// every edge but a type-only one; a lower bound when `unsized_files` is above 0.
    pub lines: f64,
    /// Effective lines in its own shipped files.
    pub own: f64,
    /// Files summed into `lines`.
    pub files: u32,
    /// Files and unresolved requests the closure reached and could not size.
    pub unsized_files: u32,
    /// Its manifest's `exports`, `main`, `module` and `bin` name none of its
    /// files, so what it ships starts at its files that nothing imports.
    pub undeclared: bool,
}

#[napi(object)]
pub struct OrientLayers {
    /// Whether the map was folded from the index as it stands now.
    pub current: bool,
    /// Every package in code-unit order of name; `undefined` when there was
    /// nothing to fold, and `unmade` says why.
    pub packages: Option<Vec<OrientPackageLayer>>,
    pub unmade: Option<String>,
}

/// Every package's layer from the map kept beside the index at `index`.
/// `undefined` when no map is kept there, or one of a format this reader does
/// not know.
#[napi(catch_unwind)]
pub fn orient_layers(index: String) -> napi::Result<Option<OrientLayers>> {
    let path = map_path(&index);
    let Some(bytes) = kept_bytes(&path).map_err(napi::Error::from_reason)? else { return Ok(None) };
    let stored: Stored = serde_json::from_slice(&bytes)
        .map_err(|error| napi::Error::from_reason(format!("the code map at {path} did not read: {error}")))?;
    let current = manifest_digest(&index).as_deref() == Some(stored.index.as_str());
    let packages = stored.made.map(|_| {
        stored
            .placed
            .into_iter()
            .map(|placed| OrientPackageLayer {
                package: placed.package,
                directory: placed.directory,
                layer: placed.layer,
                takes: placed.takes,
                lines: placed.lines as f64,
                own: placed.own as f64,
                files: placed.files,
                unsized_files: placed.unsized_files,
                undeclared: placed.undeclared,
            })
            .collect()
    });
    Ok(Some(OrientLayers { current, packages, unmade: stored.unmade }))
}
