//! Alias candidates from the same effective configuration that resolves imports.
// compass: variance-authority.reach.source-index

use super::{Governing, Resolvers};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

impl Resolvers {
    /// Missing targets matter too: adding one must invalidate the importing record.
    /// OXC owns inheritance, project references and longest-pattern matching.
    pub(crate) fn alias_candidates(
        &self,
        root: &Path,
        from: &Path,
        written: &str,
        governing: &OnceLock<Governing>,
    ) -> Vec<String> {
        let Some(request) = crate::specifier::request_of(written) else { return Vec::new() };
        if crate::specifier::is_relative(request) || Path::new(request).is_absolute() {
            return Vec::new();
        }
        let governing = governing.get_or_init(|| self.governing(from));
        let Some(config) = &governing.tsconfig else { return Vec::new() };
        let mut paths = config.resolve_path_alias_or_base_url(request);
        // Resolution also tries baseUrl after all matching paths fail.
        if let Some(base) = config.resolve_base_url(request) {
            paths.push(base);
        }
        let mut candidates: Vec<String> = paths.into_iter().filter_map(|path| {
            let normalized = crate::witness::normalize(&path.to_str()?.replace('\\', "/"));
            let path = PathBuf::from(normalized);
            let relative = path.strip_prefix(root).ok()?;
            Some(relative.to_string_lossy().replace('\\', "/"))
        }).collect();
        candidates.sort_unstable();
        candidates.dedup();
        candidates
    }
}
