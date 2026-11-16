//! Expand offered patterns over known source spellings, then let OXC resolve them.

// compass: variance-authority.reach.source-scan

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::Resolvers;
use crate::emitted::Spelling;

impl Resolvers {
    pub(crate) fn offered_requests(&self, from: &Path, files: &[PathBuf], patterns: &[String]) -> Vec<String> {
        if files.is_empty() || patterns.is_empty() { return Vec::new(); }
        let Some(directory) = from.parent() else { return Vec::new() };
        let roots = self.modules.find_tsconfig(from).ok().flatten()
            .and_then(|config| config.compiler_options.root_dirs.clone()).unwrap_or_default();
        let patterns: Vec<_> = patterns.iter().filter_map(|pattern| {
            let (prefix, suffix) = pattern.split_once('*')?;
            if suffix.contains('*') { return None; }
            let absolute = crate::conditions::normalize(&directory.join(prefix));
            let mut absolute = absolute.to_str()?.to_owned();
            if prefix.ends_with('/') && !absolute.ends_with('/') { absolute.push('/'); }
            Some((prefix, suffix, absolute))
        }).collect();
        let mut requests = HashSet::new();
        for file in files {
            let mut spellings = self.emitted.spellings(directory, file, true);
            let mut projected = Vec::new();
            for spelling in &spellings {
                for source in &roots {
                    if let Ok(rest) = spelling.path.strip_prefix(source) {
                        projected.extend(roots.iter().map(|root| Spelling { path: root.join(rest), output: spelling.output }));
                    }
                }
            }
            spellings.extend(projected);
            for spelling in spellings {
                let Some(path) = spelling.path.to_str() else { continue };
                for (prefix, suffix, absolute) in &patterns {
                    let captured = capture(path, absolute, suffix);
                    if let Some(captured) = captured {
                        requests.insert(format!("{prefix}{captured}{suffix}"));
                        continue;
                    }
                    // These are OXC's configured extension aliases and file
                    // extensions, rather than guessed trailing path segments.
                    for (alias, extensions) in self.options.extension_alias.iter().filter(|_| !spelling.output) {
                        for extension in extensions {
                            if let Some(stem) = path.strip_suffix(extension) {
                                if let Some(captured) = capture(&format!("{stem}{alias}"), absolute, suffix) {
                                    requests.insert(format!("{prefix}{captured}{suffix}"));
                                }
                            }
                        }
                    }
                    if let Some(extension) = self.options.extensions.iter().find(|extension| path.ends_with(extension.as_str())) {
                        if let Some(captured) = capture(&path[..path.len() - extension.len()], absolute, suffix) {
                            requests.insert(format!("{prefix}{captured}{suffix}"));
                        }
                    }
                }
            }
        }
        let mut requests: Vec<String> = requests.into_iter().collect();
        requests.sort_by(|a, b| crate::order::code_unit(a, b));
        requests
    }
}

fn capture<'a>(path: &'a str, prefix: &str, suffix: &str) -> Option<&'a str> {
    let end = path.len().checked_sub(suffix.len())?;
    if end <= prefix.len() || !path.is_char_boundary(prefix.len()) || !path.is_char_boundary(end)
        || !path[..prefix.len()].eq_ignore_ascii_case(prefix) || !path[end..].eq_ignore_ascii_case(suffix) { return None; }
    Some(&path[prefix.len()..end])
}
