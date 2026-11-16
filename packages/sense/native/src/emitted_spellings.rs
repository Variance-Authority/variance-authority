//! Known source paths and the paths declared output or symbolic links give them.

// compass: variance-authority.reach.source-scan

use std::path::{Path, PathBuf};

use super::{Emitted, EMITTED};

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Spelling {
    pub(crate) path: PathBuf,
    pub(crate) output: bool,
}

impl Emitted {
    /// The source and its declared output spellings. Declarations are included
    /// for entry targets, while `sideEffects` asks only for emitted code.
    pub(crate) fn spellings(&self, directory: &Path, path: &Path, declarations: bool) -> Vec<Spelling> {
        let links = self.symbolic.get_or_init(|| {
            let Some((root, listing)) = &self.listed else { return Vec::new() };
            listing.uncertain().filter_map(|path| {
                let alias = root.join(path);
                if !std::fs::symlink_metadata(&alias).ok()?.is_symlink() { return None; }
                Some((std::fs::canonicalize(&alias).ok()?, alias))
            }).collect()
        });
        let aliases = |path: &Path| links.iter().filter_map(|(real, alias)| Some(alias.join(path.strip_prefix(real).ok()?))).collect::<Vec<_>>();
        let mut sources = vec![path.to_owned()];
        sources.extend(aliases(path));
        let mut spelled: Vec<Spelling> = sources.iter().map(|path| Spelling { path: path.clone(), output: false }).collect();
        let boundary = self.listed.as_ref().map_or(directory, |(root, _)| root.as_path());
        for source in sources {
            let Some(name) = source.file_name().and_then(|name| name.to_str()) else { continue };
            for directory in source.ancestors().skip(1).take_while(|directory| directory.starts_with(boundary)) {
                for layout in self.declared(directory).iter() {
                    for mirror in &layout.sources {
                        let Ok(rest) = source.strip_prefix(&mirror.root) else { continue };
                        for (output, extensions) in EMITTED {
                            if if output.starts_with(".d.") { !declarations } else { !mirror.code } { continue; }
                            let Some(extension) = extensions.iter().find(|extension| name.len() > extension.len() && name.ends_with(*extension)) else { continue };
                            let out = layout.out.join(rest).with_file_name(format!("{}{output}", &name[..name.len() - extension.len()]));
                            spelled.extend(aliases(&out).into_iter().map(|path| Spelling { path, output: true }));
                            spelled.push(Spelling { path: out, output: true });
                        }
                    }
                }
            }
        }
        spelled.sort();
        spelled.dedup();
        spelled
    }
}
