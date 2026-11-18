    use super::*;
    use crate::generation::Delta;
    use crate::log::{written, Over};

    /// A segment of no files, told apart from another by its configuration.
    fn segment(config: &str) -> Vec<u8> {
        let document = format!(r#"{{"config": "{config}", "records": [], "parses": [], "deletedRecords": [], "deletedParses": []}}"#);
        crate::graph_index::merged(&[], &Delta::of(vec![document]).unwrap())
    }

    /// A chain of segments `a` and `b` at a fresh path, and where `b` is kept.
    fn published(name: &str) -> (std::path::PathBuf, String, String) {
        let directory = std::env::temp_dir().join(format!("va-opened-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("index.bin").to_str().unwrap().to_owned();
        let (a, b) = (segment("v1:a"), segment("v1:b"));
        assert!(written(&path, Over::Nothing, &[], &[&a, &b], &[], 0).unwrap());
        let digest = crate::digest::of_sha256(Sha256::digest(&b).as_slice());
        let second = format!("{path}.segments/{}.bin", digest.replacen(':', "-", 1));
        (directory, path, second)
    }

    /// The configuration of every layer `opened` reads.
    fn configs(opened: &OpenedIndex) -> Option<Vec<String>> {
        opened_chain(opened, |layers| layers.iter().map(|layer| layer.config.unwrap_or("").to_owned()).collect()).unwrap()
    }

    #[test]
    fn a_segment_cut_short_or_missing_is_classified_and_strict_queries_refuse_it() {
        for (name, damage) in [("cut", (|at: &str| std::fs::write(at, b"").unwrap()) as fn(&str)), ("gone", |at| std::fs::remove_file(at).unwrap())] {
            let (directory, path, second) = published(name);
            damage(&second);
            let opened = open_index(path).unwrap();
            assert_eq!(opened.status().unwrap().state, "damaged", "{name}");
            assert!(opened_chain(&opened, |layers| layers.len()).is_err());
            assert!(opened.snapshot().is_err());
            std::fs::remove_dir_all(directory).unwrap();
        }
    }

    #[test]
    fn a_segment_damaged_after_the_open_is_read_as_it_was() {
        let (directory, path, second) = published("after");
        let opened = open_index(path).unwrap();
        assert_eq!(opened.status().unwrap().state, "published");
        std::fs::write(&second, b"").unwrap();
        assert_eq!(configs(&opened), Some(vec!["v1:a".to_owned(), "v1:b".to_owned()]));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn foreign_or_malformed_segments_are_reported_without_a_second_open() {
        for (name, bytes, state, version) in [
            ("foreign", crate::segment::encode_as(crate::segment::FORMAT, 15, Vec::new()), "other-version", Some(15)),
            ("malformed", b"not an index".to_vec(), "damaged", None),
            ("manifest", b"VAIDXLSMbroken".to_vec(), "damaged", None),
        ] {
            let directory = std::env::temp_dir().join(format!("va-opened-status-{name}-{}", std::process::id()));
            std::fs::create_dir_all(&directory).unwrap();
            let path = directory.join("index.bin");
            std::fs::write(&path, bytes).unwrap();
            let opened = open_index(path.to_str().unwrap().to_owned()).unwrap();
            std::fs::remove_file(path).unwrap();
            let status = opened.status().unwrap();
            assert_eq!((status.state.as_str(), status.written), (state, version));
            assert!(opened_chain(&opened, |layers| layers.len()).is_err());
            assert!(opened.snapshot().is_err());
            std::fs::remove_dir_all(directory).unwrap();
        }
    }

    #[test]
    fn nothing_published_is_no_chain_and_a_closed_index_is_refused() {
        let directory = std::env::temp_dir().join(format!("va-opened-none-{}", std::process::id()));
        let mut opened = open_index(directory.join("index.bin").to_str().unwrap().to_owned()).unwrap();
        assert_eq!(opened.status().unwrap().state, "missing");
        assert!(opened_chain(&opened, |layers| layers.len()).unwrap().is_none());
        opened.close();
        assert!(opened.status().is_err());
        assert!(opened_chain(&opened, |layers| layers.len()).is_err());
    }

#[test]
fn record_names_use_the_opened_prefix_and_newest_record_decision_without_reopening() {
    use crate::generation::{encode_generation, Deleted, Generation};
    use crate::record::{FileRecord, Indexed};
    let directory = std::env::temp_dir().join(format!("va-record-names-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("index.bin").to_string_lossy().into_owned();
    let row = |file: &str, digest: Option<&str>| Indexed {
        record: FileRecord { file: file.into(), digest: digest.map(str::to_owned), ..FileRecord::default() },
        witnesses: Vec::new(), targets: None,
    };
    let (a, b, c) = (row("a.ts", Some("git:a")), row("b.ts", Some("git:b")), row("c.ts", Some("git:c")));
    let before = encode_generation::<crate::read::Read>(&Generation {
        config: None, directories: &[], parses: &[], records: &[("a.ts", &a), ("b.ts", &b), ("c.ts", &c)], deleted: Deleted::default(),
    });
    let (changed, unnamed) = (row("a.ts", Some("git:new")), row("b.ts", None));
    let after = encode_generation::<crate::read::Read>(&Generation {
        config: None, directories: &[], parses: &[], records: &[("a.ts", &changed), ("b.ts", &unnamed)],
        deleted: Deleted { records: &["c.ts".into()], ..Deleted::default() },
    });
    written(&path, Over::Nothing, &[], &[&before, &after], &[], 0).unwrap();
    let mut opened = open_index(path.clone()).unwrap();
    std::fs::remove_file(&path).unwrap();
    let names = opened.record_names(vec!["a.ts".into(), "b.ts".into(), "c.ts".into(), "missing.ts".into(), "a.ts".into()]).unwrap();
    assert_eq!(names.iter().map(|row| (row.file.as_str(), row.digest.as_str())).collect::<Vec<_>>(), [("a.ts", "git:new")]);
    opened.close();
    assert!(opened.record_names(vec!["a.ts".into()]).is_err());
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn component_sources_read_latest_scoped_declarations_and_identity_from_the_opened_chain() {
    use serde_json::json;
    let directory = std::env::temp_dir().join(format!("va-component-sources-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("index.bin").to_string_lossy().into_owned();
    let segment = |document| crate::graph_index::merged(&[], &serde_json::from_value::<Delta>(document).unwrap());
    let before = segment(json!({
        "parses": [["git:a\u{0}.ts\u{0}+", {"requests":[], "symbols":[
            {"name":"Panel","kind":"function","line":2}, {"name":"Other","kind":"const","line":3}]}],
            ["git:b\u{0}.ts\u{0}+", {"requests":[], "symbols":[{"name":"Panel","kind":"class","line":7}]}]],
        "records": [["src/a.ts", {"record":{"file":"src/a.ts","digest":"git:a","declares":["Panel"]},"witnesses":[]}],
            ["src/nested/b.ts", {"record":{"file":"src/nested/b.ts","digest":"git:b","declares":["Panel"]},"witnesses":[]}],
            ["src/Panel.stories.ts", {"record":{"file":"src/Panel.stories.ts","digest":"git:story"},"witnesses":[]}],
            ["src/removed.ts", {"record":{"file":"src/removed.ts","digest":"git:removed"},"witnesses":[]}],
            ["src2/outside.ts", {"record":{"file":"src2/outside.ts"},"witnesses":[]}]]
    }));
    let after = segment(json!({
        "parses": [["git:new\u{0}.ts\u{0}+", {"requests":[], "symbols":[{"name":"Panel","kind":"const","line":11}]}]],
        "records": [["src/a.ts", {"record":{"file":"src/a.ts","digest":"git:new","declares":["Panel"]},"witnesses":[]}]],
        "deletedRecords":["src/removed.ts"]
    }));
    written(&path, Over::Nothing, &[], &[&before, &after], &[], 0).unwrap();
    let mut opened = open_index(path.clone()).unwrap();
    std::fs::remove_file(&path).unwrap();
    let answer = opened.component_sources(vec!["src".into()], None, None).unwrap();
    assert_eq!(answer.components.iter().map(|row| (row.name.as_str(), row.file.as_str(), row.line, row.via.as_str())).collect::<Vec<_>>(),
        [("Panel", "src/a.ts", 11, "const"), ("Panel", "src/nested/b.ts", 7, "class")]);
    assert_eq!(answer.files, 2);
    assert_eq!(opened.component_sources(vec!["src".into()], None, Some(Vec::new())).unwrap().files, 3);
    assert!(answer.digest.starts_with("v1:"));
    assert_ne!(opened.component_sources(vec!["src/nested".into()], None, None).unwrap().digest, answer.digest);
    assert_eq!(opened.component_sources(vec!["src/".into(), "src/nested".into()], None, None).unwrap().digest, answer.digest);
    assert!(opened.component_sources(vec![".".into()], None, None).is_err());
    opened.close();
    assert!(opened.component_sources(vec!["src".into()], None, None).is_err());
    std::fs::remove_dir_all(directory).unwrap();
}
