//! A relative request answered from git's listing, before any resolver runs.
//!
//! Most requests a walk resolves name a file beside the one they are written
//! in. The module resolver finds it by asking for every candidate in turn, and
//! each ask builds a cached path, walks it and allocates; the listing holds
//! every candidate already, so the same order of candidates costs a hash
//! lookup each. Whatever the listing cannot settle alone — built output, a
//! directory with a `package.json`, a name it does not list — is the
//! resolver's, as before.

use std::path::Path;

use super::{Resolvers, MODULE_EXTENSIONS};
use crate::emitted::Known;

/// What the listing settled for a relative request.
pub(super) enum Listed {
    /// The file the module resolver would find, spelled from the root.
    File(String),
    /// Nothing the listing can answer alone: the resolvers decide.
    Unsettled,
}

/// The extensions a written `.js`, `.mjs` or `.cjs` stands for, in the order
/// the module resolver's `extension_alias` tries them.
fn aliases(extension: &str) -> Option<&'static [&'static str]> {
    match extension {
        "js" => Some(&[".ts", ".tsx", ".js", ".jsx"]),
        "mjs" => Some(&[".mts", ".mjs"]),
        "cjs" => Some(&[".cts", ".cjs"]),
        _ => None,
    }
}

impl Resolvers {
    /// The file a relative `request` written in `from` names, read from the
    /// listing in the order the module resolver tries candidates: the
    /// extension a `.js` stands for, the path as written, the path with each
    /// extension, then the directory's `index`.
    pub(super) fn listed(&self, root: &Path, from: &Path, request: &str) -> Listed {
        let Some(path) = joined(root, from, request) else {
            return Listed::Unsettled;
        };
        if path.split('/').any(|part| part == "node_modules") || self.emitted.emits(&root.join(&path)) {
            return Listed::Unsettled;
        }
        let file = |candidate: &str| self.emitted.spelled(candidate) == Some(Some(Known::File));
        let name = path.rsplit_once('/').map_or(path.as_str(), |(_, name)| name);
        let extension = name.rsplit_once('.').map(|(_, extension)| extension);
        if let Some(aliased) = extension.and_then(aliases) {
            let stem = &path[..path.len() - extension.map_or(0, str::len) - 1];
            if let Some(found) = aliased.iter().map(|alias| format!("{stem}{alias}")).find(|found| file(found)) {
                return Listed::File(found);
            }
            // A written `.js` that is there and none of its aliases is an
            // error the resolver words, and the next resolver may answer.
            if file(&path) {
                return Listed::Unsettled;
            }
        }
        if file(&path) {
            return Listed::File(path);
        }
        if let Some(found) = MODULE_EXTENSIONS.iter().map(|extension| format!("{path}{extension}")).find(|found| file(found)) {
            return Listed::File(found);
        }
        if self.emitted.spelled(&path) != Some(Some(Known::Directory)) {
            return Listed::Unsettled;
        }
        let inside = |name: &str| if path.is_empty() { name.to_owned() } else { format!("{path}/{name}") };
        if self.emitted.spelled(&inside("package.json")) != Some(None) {
            return Listed::Unsettled;
        }
        MODULE_EXTENSIONS
            .iter()
            .map(|extension| inside(&format!("index{extension}")))
            .find(|found| file(found))
            .map_or(Listed::Unsettled, Listed::File)
    }
}

/// A relative request joined onto the directory of `from`, spelled from
/// `root` with `/` and no `.` or `..` parts, or `None` for a request the
/// listing does not answer: one naming a directory only, or leaving the root.
pub(super) fn joined(root: &Path, from: &Path, request: &str) -> Option<String> {
    if !(request.starts_with("./") || request.starts_with("../")) || request.ends_with('/') {
        return None;
    }
    let directory = from.parent()?.strip_prefix(root).ok()?.to_str()?;
    let mut parts: Vec<&str> = directory.split('/').filter(|part| !part.is_empty()).collect();
    for part in request.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::joined;
    use std::path::Path;

    #[test]
    fn a_relative_request_is_spelled_from_the_root() {
        let root = Path::new("/repo");
        let from = Path::new("/repo/src/a/file.ts");
        assert_eq!(joined(root, from, "./b").as_deref(), Some("src/a/b"));
        assert_eq!(joined(root, from, "../c/./d.js").as_deref(), Some("src/c/d.js"));
        assert_eq!(joined(root, from, "../../../out"), None);
        assert_eq!(joined(root, from, "./dir/"), None);
        assert_eq!(joined(root, from, "pkg"), None);
    }
}
