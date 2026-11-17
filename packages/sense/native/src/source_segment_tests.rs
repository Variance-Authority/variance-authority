//! Existing parse generations published once, beside the records that name them.

use crate::compact::{compacted, Layer, ParseView};
use crate::generation::{encode_generation, Deleted, Generation};
use crate::index::{parses_only, way};
use crate::index_chain::read_chain;
use crate::log::{written, Over};
use crate::name_table::{Item, Scope};
use crate::source_update::UpdateOptions;

fn section_bytes(bytes: &[u8], name: &str) -> usize {
    crate::stored::Stored::open(bytes).unwrap().columns().into_iter()
        .filter(|(held, _, _)| *held == name).map(|(_, _, bytes)| bytes.len()).sum()
}

#[test]
fn parse_generations_keep_whole_facts_across_cold_warm_ready_and_store_readers() {
    let other = b"/** Shared documentation. */\nexport function named() { function nested() { return 1; } return nested(); }\n";
    let root = crate::git_fixture::repository("source-parse-generations", &[
        ("Cargo.toml", b"[package]\nname = 'fixture'\nversion = '0.1.0'\n"),
        ("src/entry.ts", b"import * as other from './other';\n/** A container. */\nexport class Container { /** Work. */ run() { return other.named(); } }\nconst instance: Container = new Container(); instance.run(); export { instance };\n"),
        ("src/other.ts", other), ("src/repeated.ts", other), ("src/repeated.tsx", other),
        ("src/lib.rs", b"/// A reached type.\npub struct Reached;\n"),
        ("unused/prepared.rs", b"/// A prepared type.\npub struct Prepared;\n"),
    ]);
    let index = root.join("cache/single.bin");
    let split_path = root.join("cache/split.bin");
    let store_path = root.join("cache/prepared.bin");
    let options = UpdateOptions {
        root: root.to_str().unwrap().to_owned(), index: index.to_str().unwrap().to_owned(),
        config: "split-fixture".to_owned(), largest_file: None, readers: None, packs: None, prepare_map: None,
        tsconfig: None, condition_names: None, aliases: None, builtins: Vec::new(),
        code_extensions: vec![".ts".to_owned(), ".tsx".to_owned(), ".rs".to_owned()],
        readable: vec![".ts".to_owned(), ".tsx".to_owned(), ".rs".to_owned()],
        stores: Some(vec![store_path.to_str().unwrap().to_owned()]),
    };
    let tree = crate::git_tree_for(options.root.clone(), vec!["src".to_owned()]).unwrap();
    let initial = tree.update_index(options.clone()).unwrap().unwrap();
    assert_eq!((initial.files, initial.parsed), (5, 6), "unreached Rust preparation is acquired once");
    let single = read_chain(index.to_str().unwrap()).unwrap().unwrap();
    let original_bytes = compacted(&single.segments.iter().map(Vec::as_slice).collect::<Vec<_>>()).unwrap();
    let original = &original_bytes;
    let layer = Layer::open(original).unwrap();
    assert_ne!(way("src/other.ts"), way("src/repeated.tsx"));
    assert_eq!(layer.parses.key.len(), 4, "equal digests share parses only within one reading way");
    for name in ["symbols.name", "exports.exported", "member-declarations.name", "member-uses.name", "own-uses.name", "nested.name", "texts.blob", "names.symbols"] {
        assert!(section_bytes(original, name) > 0, "the fixture must exercise {name}");
    }
    let keys: Vec<_> = (0..layer.parses.key.len()).map(|row| crate::parse_store::key(
        layer.stored.text(layer.parses.key.at(row)), layer.stored.text(layer.parses.way.at(row)),
    )).collect();
    let parses: Vec<_> = (0..keys.len()).map(|row| ParseView::of(&layer, row)).collect();
    let parse_rows: Vec<_> = keys.iter().zip(&parses).map(|(key, row)| (key.as_str(), row)).collect();
    let first = parses_only(&parse_rows[..2]);
    let second = parses_only(&parse_rows[2..]);
    let records: Vec<_> = (0..layer.records.file.len()).map(|row| (
        layer.stored.text(layer.records.file.at(row)), layer.records.indexed(&layer.stored, row),
    )).collect();
    let record_rows: Vec<_> = records.iter().map(|(file, row)| (*file, row)).collect();
    let directories: Vec<_> = (0..layer.directories.path.len()).map(|row| (
        layer.stored.text(layer.directories.path.at(row)).to_owned(), layer.stored.text(layer.directories.digest.at(row)).to_owned(),
    )).collect();
    let metadata = encode_generation::<ParseView>(&Generation {
        config: layer.config, directories: &directories, parses: &[], records: &record_rows, deleted: Deleted::default(),
    });
    let split = [&first[..], &second[..], &metadata[..]];
    assert!(written(split_path.to_str().unwrap(), Over::Nothing, &[], &split, &[], 0).unwrap());
    assert_eq!(compacted(&split).unwrap(), *original, "every parse, record, presence flag and name index survives");

    let chain = read_chain(split_path.to_str().unwrap()).unwrap().unwrap();
    assert_eq!((chain.references.len(), chain.working), (3, 0));
    assert_eq!(chain.segments.iter().map(Vec::as_slice).collect::<Vec<_>>(), split, "publication preserves encoded generations verbatim");
    let layers: Vec<_> = chain.segments.iter().map(|bytes| Layer::open(bytes).unwrap()).collect();
    assert_eq!(layers.last().unwrap().config, layer.config, "the final metadata layer owns configuration");
    for (file, _) in &records {
        let (_, (record_layer, row)) = crate::chain_lookup::record(&layers, file).unwrap();
        let digest = layers[record_layer].stored.optional(layers[record_layer].records.digest.at(row)).unwrap();
        let (parse_layer, parse_row) = crate::chain_lookup::parse(&layers, digest, &way(file)).unwrap();
        assert_ne!(record_layer, parse_layer, "a record joins its parse across generations");
        assert_eq!(layers[record_layer].records.targets.range(row).len(), layers[parse_layer].parses.requests.range(parse_row).len());
    }
    assert!(layers.iter().any(|layer| !layer.parses.names[Item::Symbol as usize].holding("container", Scope::Name).is_empty()));
    assert!(!super::readied(split_path.to_str().unwrap()).unwrap(), "an immutable cold base is not immediately compacted");
    let after_ready = read_chain(split_path.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(after_ready.segments, chain.segments);
    let mut warm_options = options.clone();
    warm_options.index = split_path.to_str().unwrap().to_owned();
    let warm = tree.update_index(warm_options).unwrap().unwrap();
    assert_eq!((warm.files, warm.reread, warm.parsed, warm.published), (5, 0, 0, false));

    let selected = root.join("cache/selected.bin").to_str().unwrap().to_owned();
    assert_eq!(tree.fill_parse_store(vec![selected.clone()], split_path.to_str().unwrap().to_owned()).unwrap(), 4);
    assert_eq!(tree.fill_parse_store(vec![selected.clone()], store_path.to_str().unwrap().to_owned()).unwrap(), 1, "unconsumed Rust preparation remains available exactly once");
    assert_eq!(tree.fill_parse_store(vec![selected], store_path.to_str().unwrap().to_owned()).unwrap(), 0);
    let withheld = root.join("cache/withheld.bin").to_str().unwrap().to_owned();
    let identity = tree.digest("src/entry.ts".to_owned()).unwrap();
    let oid = crate::git::parse_oid(identity.strip_prefix("git:").unwrap().as_bytes()).unwrap();
    tree.from_blob.saw(&oid, "src/entry.ts", false);
    assert_eq!(tree.fill_parse_store(vec![withheld], split_path.to_str().unwrap().to_owned()).unwrap(), 3, "the existing end gate selects shareable keys after provenance is stable");

    let sum = |name| split.iter().map(|bytes| section_bytes(bytes, name)).sum::<usize>();
    for name in ["names.parses", "names.symbols", "names.nested", "names.member-declarations"] {
        assert_eq!(sum(name), section_bytes(original, name), "name payload is not multiplied");
    }
    let difference = |name| sum(name) as i64 - section_bytes(original, name) as i64;
    let dictionaries = difference("strings.blob") + difference("strings.off");
    let texts = difference("texts.blob") + difference("texts.off");
    let payload = |bytes: &[u8]| crate::stored::Stored::open(bytes).unwrap().columns().into_iter().map(|(_, _, bytes)| bytes.len()).sum::<usize>();
    let payload_growth = split.iter().map(|bytes| payload(bytes)).sum::<usize>() as i64 - payload(original) as i64;
    assert_eq!(payload_growth, dictionaries + texts + 2 * 26 * 4, "all remaining growth is the estimator's per-segment sentinels");
    let actual = split.iter().map(|bytes| bytes.len()).sum::<usize>();
    println!("segmented fixture: single={} split={} growth={}; dictionary={} text={} other-sentinels={} framing-and-padding={}", original.len(), actual, actual as i64-original.len() as i64, dictionaries, texts, 2*26*4, actual as i64-original.len() as i64-payload_growth);
    std::fs::remove_dir_all(root).unwrap();
}
