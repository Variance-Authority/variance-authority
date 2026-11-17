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
