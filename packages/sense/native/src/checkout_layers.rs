//! Where a checkout's source index and records live: the cache layers a
//! reader finds from the checkout's path, its configuration and the
//! environment, the addon and the standalone executable alike.

// compass: variance-authority.reach.source-index

use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};

use serde_json::Value;

/// A checkout's own cache layer over its primary checkout's.
pub(crate) struct Layers {
    pub(crate) top: PathBuf,
    pub(crate) base: PathBuf,
    pub(crate) cache: PathBuf,
    #[cfg_attr(not(feature = "standalone-cli"), allow(dead_code))]
    pub(crate) primary: PathBuf,
    #[cfg_attr(not(feature = "standalone-cli"), allow(dead_code))]
    pub(crate) primary_cache: PathBuf,
}

impl Layers {
    /// The layers of the checkout at `root`, or why they cannot be found.
    pub(crate) fn found(root: &Path) -> Result<Self, String> {
        if std::env::var_os("GIT_DIR").is_some() || std::env::var_os("GIT_WORK_TREE").is_some() {
            return Err("GIT_DIR or GIT_WORK_TREE is set, so the checkout git reads may not be the one the working directory is in; unset them to ask from here".to_owned());
        }
        let primary = primary_checkout(root);
        let checkout = root.ancestors().find(|at| at.join(".git").exists()).unwrap_or(root);
        let cache = cache_found(checkout)?;
        let layer = |cache: &Path| -> Result<PathBuf, String> {
            Ok(cache.join("test-selection").join(checkout_key(&primary, cache).ok_or_else(|| unspelled(cache))?))
        };
        let primary_cache = if primary == root { cache.clone() } else { cache_found(&primary)? };
        let base = layer(&primary_cache)?;
        let top = if primary == root {
            base.clone()
        } else {
            layer(&cache)?.join(".work").join(checkout_key(root, &cache).ok_or_else(|| unspelled(&cache))?)
        };
        Ok(Self { top, base, cache, primary, primary_cache })
    }

    #[cfg(feature = "standalone-cli")]
    pub(crate) fn at(root: &Path) -> Option<Self> {
        Self::found(root).ok()
    }
}

fn unspelled(cache: &Path) -> String {
    format!("the cache path {} is not UTF-8", cache.display())
}

pub(crate) fn primary_checkout(root: &Path) -> PathBuf {
    let named = std::fs::read_to_string(root.join(".git")).ok().and_then(|pointer| {
        pointer.lines().find_map(|line| line.strip_prefix("gitdir:")).map(|path| root.join(path.trim()))
    });
    if let Some(git_dir) = named {
        if let Some(worktrees) = git_dir.parent().filter(|path| path.ends_with(".git/worktrees")) {
            if let Some(primary) = worktrees.parent().and_then(Path::parent) {
                return physical(primary);
            }
        }
    }
    root.to_owned()
}

/// The checkout's `variance.config.json`, absent when it has none, or why it does not read.
pub(crate) fn config_read(checkout: &Path) -> Result<Option<Value>, String> {
    let at = checkout.join("variance.config.json");
    match std::fs::read(&at) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|error| format!("{} does not parse: {error}", at.display())),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{} does not open: {error}", at.display())),
    }
}

#[cfg(feature = "standalone-cli")]
pub(crate) fn root_config(checkout: &Path) -> Option<Option<Value>> {
    config_read(checkout).ok()
}

fn cache_found(checkout: &Path) -> Result<PathBuf, String> {
    if let Some(named) = config_read(checkout)?.as_ref().and_then(|config| config.get("cacheRoot")) {
        return named.as_str().filter(|name| !name.is_empty()).map(|name| crate::conditions::normalize(&checkout.join(name)))
            .ok_or_else(|| format!("the `cacheRoot` of {} is not a path", checkout.join("variance.config.json").display()));
    }
    Ok(std::env::var_os("VARIANCE_AUTHORITY_CACHE").map(PathBuf::from).filter(|path| path.is_absolute())
        .map(|path| crate::conditions::normalize(&path)).unwrap_or_else(|| checkout.join("node_modules/.cache/variance-authority")))
}

pub(crate) fn physical(path: &Path) -> PathBuf {
    let canonical = path.canonicalize().or_else(|_| {
        let parent = path.parent().ok_or_else(|| io::Error::from(ErrorKind::NotFound))?;
        let name = path.file_name().ok_or_else(|| io::Error::from(ErrorKind::NotFound))?;
        Ok::<_, io::Error>(physical(parent).join(name))
    });
    let canonical = canonical.unwrap_or_else(|_| path.to_owned());
    if cfg!(windows) {
        if let Some(text) = canonical.to_str() {
            if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
                return PathBuf::from(format!(r"\\{unc}"));
            }
            if let Some(drive) = text.strip_prefix(r"\\?\") {
                return PathBuf::from(drive);
            }
        }
    }
    canonical
}

fn checkout_key(checkout: &Path, cache: &Path) -> Option<String> {
    let spelling = seen_from(checkout, cache);
    let digest = crate::digest::of_string(spelling.to_str()?);
    Some(digest.split_once(':')?.1.to_owned())
}

pub(crate) fn seen_from(checkout: &Path, cache: &Path) -> PathBuf {
    let cache = physical(cache);
    let mut from = cache.components().peekable();
    let mut to = checkout.components().peekable();
    let mut common = false;
    while from.peek().is_some() && from.peek() == to.peek() {
        common = true;
        from.next();
        to.next();
    }
    if common {
        let mut relative: PathBuf = from.map(|_| "..").collect();
        relative.extend(to);
        relative
    } else {
        checkout.to_owned()
    }
}
