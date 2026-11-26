//! The index and record cache layers a standalone command reads and writes.

// compass: variance-authority.reach.source-index

use std::path::Path;

pub(crate) use crate::checkout_layers::Layers;

impl Layers {
    pub(super) fn mark(&self, root: &Path) {
        let Some(checkout) = super::seen_from(root, &self.cache).to_str().map(str::to_owned) else { return };
        let Some(primary) = super::seen_from(&self.primary, &self.cache).to_str().map(str::to_owned) else { return };
        let marker = self.top.join("checkout.json");
        if let Some(marker) = marker.to_str() {
            let contents = serde_json::json!({ "checkout": checkout, "primary": primary }).to_string();
            let _ = crate::journey_output::replace(marker, contents.as_bytes());
        }
    }

    pub(super) fn indexes_beside(&self, root: &Path) -> Vec<String> {
        let (Some(root_text), Some(primary)) = (root.to_str(), self.primary.to_str()) else { return Vec::new() };
        let Some(list) = crate::git::git(root_text, &["worktree", "list", "--porcelain", "-z"], None) else {
            return Vec::new();
        };
        let Ok(list) = std::str::from_utf8(&list) else { return Vec::new() };
        let paths = list.split("\0\0").filter_map(|entry| {
            let mut fields = entry.split('\0');
            let path = fields.next()?.strip_prefix("worktree ")?;
            (!fields.any(|field| field.starts_with("prunable") || field == "bare")).then_some(path)
        });
        let primary_if_other = (root_text != primary).then_some(primary);
        primary_if_other
            .into_iter()
            .chain(paths.filter(|path| *path != primary))
            .filter_map(|path| {
                let checkout = super::physical(Path::new(path));
                if checkout == root {
                    return None;
                }
                let index = super::source_index(&checkout)?;
                index.is_file().then(|| index.to_str().map(str::to_owned)).flatten()
            })
            .collect()
    }

    pub(super) fn parse_stores(&self, root: &str) -> Option<Vec<String>> {
        (!rewrites_parsed(root)).then_some(())?;
        let store = |cache: &Path| cache.join("test-selection/.parses/parses.bin").into_os_string().into_string().ok();
        let mut stores = vec![store(&self.cache)?];
        if self.primary_cache != self.cache {
            stores.push(store(&self.primary_cache)?);
        }
        Some(stores)
    }
}

fn rewrites_parsed(root: &str) -> bool {
    let git = |args: &[&str]| crate::git::git(root, args, None);
    let config = git(&["config", "--type=bool-or-str", "--get-regexp", r"^core\.(autocrlf|eol)$"])
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let get = |key| {
        config.lines().find_map(|line| {
            let mut parts = line.split_whitespace();
            (parts.next() == Some(key)).then(|| parts.next()).flatten()
        })
    };
    let autocrlf = get("core.autocrlf");
    if autocrlf == Some("true") {
        return true;
    }
    let eol = get("core.eol").unwrap_or("native");
    let crlf = autocrlf != Some("input") && (eol == "crlf" || (eol == "native" && cfg!(windows)));
    let mut eol_args = vec!["ls-files", "-z", "--", ":(top,attr:eol=crlf)"];
    if crlf {
        eol_args.extend([":(top,attr:text)", ":(top,attr:text=auto)", ":(top,attr:crlf)"]);
    }
    let readable = |bytes: Vec<u8>| {
        bytes
            .split(|&byte| byte == 0)
            .any(|file| std::str::from_utf8(file).is_ok_and(|path| crate::read_any::language_of(path).is_some()))
    };
    let (line_endings, filters) = rayon::join(
        || git(&eol_args),
        || git(&["ls-files", "-z", "--", ":(top)", ":(top,exclude,attr:!filter !ident !working-tree-encoding)"]),
    );
    line_endings.is_none_or(readable) || filters.is_none_or(readable)
}
