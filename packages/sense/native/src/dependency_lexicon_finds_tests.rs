//! A question asked of a catalogue with the finds tables answers exactly as it does of the same catalogue without
//! them, where every entry is decoded.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, BTreeSet};

use super::catalogue::{Made, MadeInstall, MadePair};
use super::codec::api;
use super::purposes::{stems, Purpose};
use super::query::query_dependency_lexicon;
use super::{Api, Identity, Name, Owner, Readme};

fn name(name: &str, doc: &str) -> Name {
    Name { name: name.to_owned(), kind: "function".to_owned(), at: "index.d.ts".to_owned(), line: 1, signature: None,
        doc: Some(doc.to_owned()) }
}

fn said(text: &str) -> Vec<String> {
    let mut said: Vec<String> = stems(text).into_iter().collect::<BTreeSet<_>>().into_iter().collect();
    said.sort();
    said
}

fn entry(package: &str, names: Option<Vec<Name>>, unavailable: Option<&str>, says: &str) -> Vec<u8> { told(package, names, unavailable, says, None) }

fn told(package: &str, names: Option<Vec<Name>>, unavailable: Option<&str>, says: &str, readme: Option<Readme>) -> Vec<u8> {
    api(&Api {
        runtime: Some(Identity { name: package.to_owned(), version: "1.0.0".to_owned(), manifest: format!("node_modules/{package}/package.json") }),
        declarations: None, entrypoint: None, names, sources: None, unavailable: unavailable.map(str::to_owned), readme,
        purpose: (!says.is_empty()).then(|| Purpose { said: said(says), ..Purpose::default() }), skills: None,
    })
}

fn made() -> Made {
    let packages = ["alpha", "beta", "gamma", "broken", "buttonkit", "delta", "epsilon"];
    let entries = vec![
        entry("alpha", Some(vec![name("Button", "A clickable button"), name("Dialog", "Opens a modal")]), None, "clickable buttons for forms"),
        entry("beta", None, Some("it ships no declarations"), ""),
        entry("gamma", Some(vec![name("Table", "Renders rows of data"), name("button", "Lowercase twin")]), None, "renders data rows in tables"),
        vec![0xff],
        entry("buttonkit", Some(vec![name("Other", "Nothing to see")]), None, ""),
        told("delta", None, Some("it ships no declarations"), "", Some(Readme { at: "node_modules/delta/README.md".to_owned(), lines: Some(3), unreadable: None })),
        told("epsilon", None, Some("it ships no declarations"), "", Some(Readme { at: "node_modules/epsilon/README.md".to_owned(), lines: None, unreadable: Some("denied".to_owned()) })),
    ];
    let kinds: BTreeMap<String, &'static str> = packages.iter().map(|package| (package.to_string(), "dependency")).collect();
    let owners = ["app", "lib"].map(|directory| Owner { manifest: format!("{directory}/package.json"), directory: directory.to_owned(),
        name: directory.to_owned(), declared: kinds.keys().cloned().collect(), kinds: kinds.clone() });
    Made {
        owners: owners.to_vec(),
        manifests: owners.iter().map(|owner| owner.manifest.clone()).collect(),
        internal: Vec::new(),
        pairs: (0..2).flat_map(|owner| (0..packages.len() as u32).map(move |install| MadePair { owner, package: packages[install as usize].to_owned(), install, issues: Vec::new() })).collect(),
        installs: packages.iter().enumerate().map(|(at, package)| MadeInstall { key: format!("{package}@1.0.0"), package: package.to_string(),
            offers: vec![(package.to_string(), at as u32, true)] }).collect(),
        entries: packages.iter().zip(entries).map(|(package, bytes)| (format!("{package}@1.0.0"), bytes)).collect(),
        stamps: Vec::new(),
        summary: [5, 5, 4, 1],
    }
}

#[test]
fn the_finds_tables_change_no_answer() {
    let made = made();
    let folder = std::env::temp_dir().join(format!("finds-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let (with, without) = (folder.join("with.bin"), folder.join("without.bin"));
    std::fs::write(&with, made.encode()).unwrap();
    std::fs::write(&without, made.encode_before_finds()).unwrap();
    let sites = folder.join("absent").to_string_lossy().into_owned();
    let questions: [(&str, bool, Option<&str>); 14] = [
        ("forms widgets", false, None),
        ("Button", true, None), ("button", true, None), ("Missing", true, None), ("Table", true, Some("gamma")),
        ("button", false, None), ("MODAL", false, None), ("rows of data", false, None), ("", false, None),
        ("renders tables", false, None), ("button", false, Some("buttonkit")),
        ("Button", true, Some("beta")), ("Missing", true, Some("epsilon")), ("Missing", true, Some("delta")),
    ];
    for (query, exact, package) in questions {
        for files in [None, Some(Vec::new())] {
            let ask = |path: &std::path::Path| query_dependency_lexicon(path.to_string_lossy().into_owned(), sites.clone(),
                query.to_owned(), files.clone(), exact, package.map(str::to_owned), 50).unwrap().unwrap();
            let answer = ask(&with);
            assert_eq!(answer, ask(&without), "{query:?} exact {exact} package {package:?} files {files:?}");
            assert!(!answer.contains("\"packages\":0") || files.is_some(), "{query:?} looked at nothing: {answer}");
        }
    }
    std::fs::remove_dir_all(folder).unwrap();
}
