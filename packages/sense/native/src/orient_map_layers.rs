//! Every package's layer, closure and area, read from the code map kept beside
//! the index (`orient_map.rs`) for `variance layers` and `ask classify`.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

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
    /// Effective lines over every sized file its entries load, through
    /// every edge but a type-only one; a lower bound when `unsized_files` is above 0.
    pub lines: f64,
    /// Effective lines in the files of its own that its entries load.
    pub own: f64,
    /// Files summed into `lines`.
    pub files: u32,
    /// Files and unresolved requests the closure reached and could not size.
    pub unsized_files: u32,
    /// Its manifest's `exports`, `main`, `module` and `bin` name none of its
    /// files, so what it ships starts at the files its own code never imports.
    pub undeclared: bool,
    /// The innermost area whose page lists it; `undefined` for a package only
    /// the top page lists.
    pub area: Option<OrientPackageArea>,
}

/// An area as the map's pages number and name it.
#[napi(object)]
pub struct OrientPackageArea {
    pub id: String,
    pub name: String,
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
    // A page lists only the packages no area inside it took, so each package
    // is listed on exactly one page.
    let mut areas: HashMap<String, (String, String)> = HashMap::new();
    for page in stored.pages.into_iter().filter(|page| !page.id.is_empty()) {
        for package in page.list {
            areas.insert(package, (page.id.clone(), page.name.clone()));
        }
    }
    let packages = stored.made.map(|_| {
        stored
            .placed
            .into_iter()
            .map(|placed| OrientPackageLayer {
                area: areas.remove(&placed.package).map(|(id, name)| OrientPackageArea { id, name }),
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
