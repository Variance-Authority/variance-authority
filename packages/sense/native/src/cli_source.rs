//! Update the same source chain that the addon reads and writes.

// compass: variance-authority.reach.source-index

use std::path::Path;

use crate::acquire::LARGEST_FILE;
use crate::read_any::{language_of, Language, EXTENSIONS};
use crate::resolve::Tsconfig;
use crate::source_update::{UpdateOptions, Updated};
use crate::GitTree;
use serde_json::Value;

pub(super) fn tsconfig(root: &Path, config: Option<&Value>) -> Option<Tsconfig> {
    let Some(raw) = config.and_then(|value| value.get("typescript")) else { return Some(Tsconfig::Auto) };
    let object = raw.as_object()?;
    if object.keys().any(|key| key != "tsconfig") {
        return None;
    }
    match object.get("tsconfig") {
        None => Some(Tsconfig::Auto),
        Some(Value::Bool(false)) => Some(Tsconfig::Off),
        Some(Value::String(value)) if value == "auto" => Some(Tsconfig::Auto),
        Some(Value::String(value)) if !value.is_empty() && !Path::new(value).is_absolute() => {
            let path = crate::conditions::normalize(&root.join(value));
            (path.starts_with(root) && path.is_file()).then_some(Tsconfig::Named(path))
        }
        _ => None,
    }
}

pub(super) fn code_extensions() -> Vec<String> {
    EXTENSIONS.iter().filter(|ext| language_of(ext) != Some(Language::Style)).map(|ext| (*ext).to_owned()).collect()
}

#[derive(Default)]
pub(super) struct Reuse {
    pub(super) stores: Option<Vec<String>>,
    pub(super) others: Vec<String>,
}

pub(super) fn refresh(
    tree: &GitTree,
    root: &str,
    index: &str,
    tsconfig: &Tsconfig,
    no_git: bool,
    reuse: Reuse,
) -> Option<napi::Result<Updated>> {
    let (named, option) = match tsconfig {
        Tsconfig::Auto => ("auto".to_owned(), None),
        Tsconfig::Off => ("off".to_owned(), Some(napi::Either::B(false))),
        Tsconfig::Named(path) => (
            format!("file {}", path.strip_prefix(root).ok()?.to_str()?.replace('\\', "/")),
            Some(napi::Either::A(path.to_str()?.to_owned())),
        ),
    };
    // The cache shape's spelling is shared with reuse.ts.
    let shape =
        format!("version 14\ntsconfig {named}\nconditions source,import,require,default + tsconfig customConditions");
    let mut digest = crate::digest::of_string(&shape);
    if tree.disk.is_some() {
        digest = crate::digest::of_string(&format!("not listed by git\n{digest}"));
    }
    Some(tree.update_index(UpdateOptions {
        root: root.to_owned(),
        index: index.to_owned(),
        config: digest,
        largest_file: Some(LARGEST_FILE),
        readers: None,
        tsconfig: option,
        condition_names: None,
        builtins: include_str!("node_builtins.txt").lines().map(str::to_owned).collect(),
        code_extensions: code_extensions(),
        readable: EXTENSIONS.iter().map(|ext| (*ext).to_owned()).collect(),
        stores: reuse.stores,
        packs: no_git.then_some(false),
        others: (!reuse.others.is_empty()).then_some(reuse.others),
        published: None,
    }))
}
