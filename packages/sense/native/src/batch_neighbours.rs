//! What a language that reads its neighbours (Rust's module tree) is told
//! they say, and how the walk that reaches the same files takes those reads
//! rather than reading them again.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use rustc_hash::FxHashMap;

use super::walk::{read_kept, Kept};
use crate::acquire::{Answer, TreeObjects};
use crate::git::Oid;
use crate::parse_origin::FromBlob;

/// The files a world's index read this run, by path, each as the walk would
/// have read it and with whether `kept` answered it, until the walk takes it.
/// A run reads its tree once, so a path names the same content throughout.
#[derive(Default)]
pub(crate) struct Neighbours(Mutex<FxHashMap<String, (Answer, bool)>>);

impl Neighbours {
    /// Every row of `files` in order, with whether `kept` gave it: a file the
    /// index read is taken from here, and `reading` is asked for the rest.
    pub(crate) fn first(
        &self,
        files: &[String],
        oids: Vec<Option<Oid>>,
        reading: impl FnOnce(&[String], Vec<Option<Oid>>) -> (Vec<Answer>, Vec<bool>),
    ) -> (Vec<Answer>, Vec<bool>) {
        let taken: Vec<Option<(Answer, bool)>> = {
            let mut held = self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            files.iter().map(|file| held.remove(file)).collect()
        };
        let (unread, unread_oids): (Vec<String>, Vec<Option<Oid>>) =
            files.iter().zip(oids).zip(&taken).filter(|(_, taken)| taken.is_none()).map(|((file, oid), _)| (file.clone(), oid)).unzip();
        let (fresh, fresh_kept) = if unread.is_empty() { (Vec::new(), Vec::new()) } else { reading(&unread, unread_oids) };
        let mut fresh = fresh.into_iter().zip(fresh_kept);
        taken.into_iter().filter_map(|taken| taken.or_else(|| fresh.next())).unzip()
    }
}

/// What a language that reads its neighbours is told they say: read together,
/// as the walk reads a wave, out of Git when the tree names them and answered
/// by `kept` when it holds them, each kept in `read` for the walk. The world
/// it serves is built once per run, so they are read once per run.
#[allow(clippy::too_many_arguments)]
pub(crate) fn neighbours<'n>(
    root: &'n str,
    at: &'n HashMap<String, u32>,
    tree_oids: &'n [Oid],
    largest_file: Option<u32>,
    readers: Option<u32>,
    kept: Kept<'n>,
    from_blob: &'n FromBlob,
    store: &'n TreeObjects,
    read: &'n Neighbours,
) -> impl Fn(&[&str]) -> Vec<Option<crate::read::Read>> + Sync + 'n {
    move |asked: &[&str]| {
        let files: Vec<String> = asked.iter().map(|file| (*file).to_owned()).collect();
        let oids = files.iter().map(|file| at.get(file).map(|index| tree_oids[*index as usize])).collect();
        let reading = Some(readers.unwrap_or(6).max(1));
        // Digests as the walk reads them, so a row taken from here is the walk's own.
        let (answers, answered) = read_kept(root, store, &files, oids, largest_file, Some(true), reading, kept, from_blob);
        let parses = answers.iter().map(|(parse, _, outcome)| outcome.parsed().then(|| parse.clone())).collect();
        read.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner).extend(files.into_iter().zip(answers.into_iter().zip(answered)));
        parses
    }
}

/// A file's text off the disk under `root`: what a manifest is read as.
pub(crate) fn texting(root: &str) -> impl Fn(&str) -> Option<String> + Sync + '_ {
    move |path: &str| std::fs::read_to_string(Path::new(root).join(path)).ok()
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::batch::{walk_beyond, GraphOptions};
    use crate::emitted::Listing;
    use crate::world::World;

    /// A cold walk holds no parse: the module tree reads every `.rs` file and
    /// the wave that reaches one takes that read, so each is opened once.
    #[cfg(feature = "grammars")]
    #[test]
    fn a_cold_walk_reads_each_rust_file_once_across_the_wave_and_the_module_tree() {
        let files = [("src/lib.rs", "mod a;\nmod b;\n"), ("src/a.rs", "use crate::b;\n"), ("src/b.rs", "pub fn b() {}\n")];
        let root = std::env::temp_dir().join(format!("sense-walk-cold-{}", std::process::id()));
        for (file, text) in files {
            std::fs::create_dir_all(root.join(file).parent().unwrap()).unwrap();
            std::fs::write(root.join(file), text).unwrap();
        }
        let at: HashMap<String, u32> = files.iter().map(|(file, _)| (*file).to_owned()).zip(0..).collect();
        let oids: Vec<Oid> = (0..files.len() as u8).map(|n| [n + 1; 20]).collect();
        let asked = Mutex::new(Vec::<String>::new());
        let kept = |_: &str, file: &str| {
            asked.lock().unwrap().push(file.to_owned());
            None
        };
        let (from_blob, store, read) = (FromBlob::default(), TreeObjects::default(), Neighbours::default());
        let root_text = root.to_string_lossy().into_owned();
        let parsing = neighbours(&root_text, &at, &oids, None, None, &kept, &from_blob, &store, &read);
        let texting = |_: &str| None;
        let world = World::new(Some(&at), None).reading(&parsing, &texting);
        let options = GraphOptions {
            root: root_text.clone(),
            seeds: vec!["src/lib.rs".to_owned()],
            largest_file: None,
            readers: None,
            tsconfig: crate::resolve::Tsconfig::from_js(None),
            condition_names: None,
            include_parses: false,
        };
        let walked = walk_beyond(options, &at, &oids, Arc::new(Listing::default()), &world, &read, &|_| false, &kept, &from_blob, &store);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(walked.files, ["src/lib.rs", "src/a.rs", "src/b.rs"]);
        assert_eq!(walked.targets[0].first, ["src/a.rs", "src/b.rs"]);
        assert_eq!(walked.targets[1].first, ["src/b.rs"]);
        assert!(walked.read.iter().all(|(_, digest, outcome)| outcome.parsed() && !digest.is_empty()) && walked.kept.iter().all(|kept| !kept));
        let mut asked = asked.lock().unwrap().clone();
        asked.sort_unstable();
        assert_eq!(asked, ["src/a.rs", "src/b.rs", "src/lib.rs"]);
    }
}
