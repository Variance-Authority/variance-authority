//! The store's bytes, pinned: how the encoder holds its rows may change, what
//! it writes may not.

use sha2::{Digest, Sha256};

use crate::help_store::{encode, DeepRef, HelpStore, PackageRef, Packages, StoreDeep, StoreEntry, StoreMention, StoreOpening, StorePackage, StoreRef, StoreUse};
use crate::help_usage::NamedExport;

/// Words a doc or a signature is written in: several words in one token,
/// short terms, terms two rows share, and text outside ASCII.
const WORDS: [&str; 12] =
    ["readFile", "the", "a", "HTTPServer", "Ünïcode", "x", "parse_json", "Promise<Node>", "A | B", "`code`", "naïve—dash", "日本語"];

fn text(seed: usize, length: usize) -> String {
    (0..length).map(|at| WORDS[(seed * 7 + at * 5) % WORDS.len()]).collect::<Vec<_>>().join(if seed % 3 == 0 { " " } else { ", " })
}

fn site(seed: usize) -> StoreUse {
    StoreUse {
        by: format!("pkg-{}", seed % 5),
        at: format!("src/use-{}.ts", seed % 40),
        line: seed as u32,
        r#type: seed % 2 == 0,
        kind: ["source", "test", "story"][seed % 3].to_owned(),
        local: (seed % 4 == 0).then(|| format!("local{seed}")),
        through: [None, Some("dynamic"), Some("namespace")][seed % 3].map(str::to_owned),
        through_line: seed as u32 % 9,
        through_default: seed % 5 == 0,
        whole: seed % 7 == 0,
        name: (seed % 3 == 0).then(|| format!("name{}", seed % 11)),
    }
}

fn entry(seed: usize) -> StoreEntry {
    StoreEntry {
        name: format!("{}{}", WORDS[seed % WORDS.len()], seed % 900),
        kind: ["function", "type", "class", "const"][seed % 4].to_owned(),
        at: format!("src/file-{}.ts", seed % 300),
        declared: format!("src/declared-{}.ts", seed % 50),
        line: seed as u32 % 400,
        signature: (seed % 3 != 1).then(|| text(seed + 1, 1 + seed % 4)),
        doc: (seed % 5 != 2).then(|| text(seed, 1 + seed % 9)),
        used_by: (0..seed % 3).map(|by| format!("pkg-{by}")).collect(),
        uses: seed as u32 % 13,
        sites: (0..seed % 3).map(|at| site(seed + at)).collect(),
        through_default: (0..seed % 2).map(|at| site(seed * 3 + at)).collect(),
        mention: (seed % 6 == 0).then(|| StoreMention { at: "README.md".to_owned(), line: seed as u32, text: text(seed, 3) }),
    }
}

fn export(seed: usize) -> NamedExport {
    NamedExport {
        name: format!("{}{}", WORDS[(seed + 3) % WORDS.len()], seed % 700),
        at: format!("src/file-{}.ts", seed % 300),
        by: format!("pkg-{}", seed % 5),
        line: seed as u32 % 500,
        r#type: seed % 4 == 0,
        kind: ["source", "test", "story", "other"][seed % 4].to_owned(),
        bound: (seed % 2 == 0).then(|| format!("bound{seed}")),
        declaration: [None, Some("function"), Some("type")][seed % 3].map(str::to_owned),
        bound_line: (seed % 5 == 0).then_some(seed as u32),
        doc: (seed % 4 != 3).then(|| text(seed * 2, 1 + seed % 7)),
        signature: (seed % 3 != 0).then(|| text(seed + 5, 1 + seed % 3)),
    }
}

fn deep(seed: usize) -> StoreDeep {
    StoreDeep {
        specifier: format!("pkg-{}/deep/{seed}", seed % 5),
        by: format!("pkg-{}", seed % 4),
        at: format!("src/deep-{seed}.ts"),
        line: seed as u32,
        to: (seed % 2 == 0).then(|| format!("src/to-{seed}.ts")),
        names: (0..seed % 3).map(|at| site(seed * 5 + at)).collect(),
    }
}

/// Packages of openings of entries, more rows than one batch of the encoder
/// holds, and export rows beside them.
fn store() -> (HelpStore, Vec<NamedExport>) {
    let mut seed = 0;
    let packages = (0..7).map(|package| StorePackage {
        name: format!("pkg-{package}"),
        entry: package % 2 == 0,
        openings: (0..3).map(|opening| StoreOpening {
            subpath: if opening == 0 { ".".to_owned() } else { format!("./sub{opening}") },
            source: format!("src/index-{opening}.ts"),
            spec: format!("pkg-{package}/sub{opening}"),
            entries: (0..1500 + package * 37).map(|_| {
                seed += 1;
                entry(seed)
            }).collect(),
            whole: (0..opening).map(|at| site(package * 11 + at)).collect(),
        }).collect(),
    }).collect();
    let store = HelpStore {
        packages,
        deep: (0..9).map(deep).collect(),
        by_path: (9..14).map(deep).collect(),
        unfollowed: (14..16).map(deep).collect(),
        unreadable: vec!["src/broken.ts".to_owned(), "src/also.ts".to_owned()],
    };
    (store, (0..40_000).map(export).collect())
}

/// The store's length and sha256, encoded from `packages`.
fn written(packages: impl FnOnce(Vec<PackageRef>) -> Box<dyn Packages + '_>, held: &HelpStore, exported: &[NamedExport]) -> (usize, String) {
    let deep = [&held.deep, &held.by_path, &held.unfollowed].map(|held| held.iter().map(DeepRef::from).collect());
    let packages = packages(held.packages.iter().map(PackageRef::from).collect());
    let input = StoreRef { packages: packages.as_ref(), deep, unreadable: &held.unreadable };
    let (bytes, _) = encode(&input, exported, None, None).unwrap();
    (bytes.len(), Sha256::digest(&bytes).iter().map(|byte| format!("{byte:02x}")).collect())
}

const PINNED: (usize, &str) = (10_350_440, "41deaa65730da1989362bf1f41673f385bebdd9e0273d0b4aeb8a66d8cf57b2a");

#[test]
fn the_store_is_written_byte_for_byte_as_before() {
    let (held, exported) = store();
    let (length, digest) = written(|packages| Box::new(packages), &held, &exported);
    assert_eq!((length, digest.as_str()), PINNED);
}

/// Packages handed to the encoder `size` at a time.
struct InRuns<'a>(Vec<PackageRef<'a>>, usize);

impl Packages for InRuns<'_> {
    fn names(&self) -> Vec<&str> {
        self.0.names()
    }

    fn each<'s>(&'s self, visit: &mut dyn FnMut(&[PackageRef<'s>])) -> Result<(), String> {
        self.0.chunks(self.1).for_each(visit);
        Ok(())
    }
}

#[test]
fn packages_handed_over_in_runs_write_the_store_they_write_at_once() {
    let (held, exported) = store();
    for size in [1, 2, 5] {
        let (length, digest) = written(|packages| Box::new(InRuns(packages, size)), &held, &exported);
        assert_eq!((length, digest.as_str()), PINNED, "runs of {size}");
    }
}
