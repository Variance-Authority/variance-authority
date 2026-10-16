//! Shards of one build that describe one text two ways: one cut the module,
//! another carried a row an older writer cut.

use super::tests::{combined, files, named};
use super::*;
use crate::record_fixture::{self as fixture, block, module, spec, test};

/// A region named `name` inside region `owner`, entered by `called`.
fn inside(ordinal: u32, name: &str, owner: u32, called: &[u32]) -> fixture::Block {
    fixture::Block { name: name.to_owned(), owner, ..block(ordinal, called) }
}

/// `src/a.ts` as one build cuts it: a callback passed twice, so two regions
/// share an address, and a function after them.
fn cut_of_a() -> Vec<fixture::Block> {
    vec![block(0, &[]), inside(1, "cb", 0, &[]), inside(2, "cb", 0, &[]), inside(3, "g#0", 0, &[])]
}

/// Two shards of one build that describe `src/a.ts`, one text, two ways: `a`
/// carried a row an older writer cut without the second callback; `b` cut it.
fn disputed() -> (Vec<u8>, Vec<u8>) {
    let stale = vec![block(0, &[0]), inside(1, "cb", 0, &[0]), inside(2, "g#0", 0, &[0])];
    let fresh = vec![block(0, &[0]), inside(1, "cb", 0, &[]), inside(2, "cb", 0, &[]), inside(3, "g#0", 0, &[0])];
    let one = fixture::write(&spec(vec![test("a.test.ts")], vec![module("src/a.ts", stale)]));
    let other = fixture::write(&spec(vec![test("b.test.ts")], vec![module("src/a.ts", fresh)]));
    (one, other)
}

#[test]
fn names_the_modules_two_shards_describe_differently_and_writes_nothing() {
    let (one, other) = disputed();
    let combined = combined(&[&one, &other]).unwrap();
    let disputed = combined.result.disputed.expect("the fold names what it needs cut");
    assert_eq!((disputed.instrumentation.as_str(), disputed.files), ("istanbul", files(&["src/a.ts"])));
    assert!(combined.bytes.is_empty());
}

#[test]
fn folds_a_disputed_module_onto_the_build_s_own_cut_carrying_crossings_by_address() {
    let (one, other) = disputed();
    let cut = fixture::write(&spec(Vec::new(), vec![module("src/a.ts", cut_of_a())]));
    let folded = combine_bytes(&named(&[&one, &other]), Some(&cut)).unwrap();
    assert!(folded.result.disputed.is_none());
    let (tests, modules) = fixture::read(&folded.bytes);
    // The second callback is new to `a`'s row, so `a` is taken to have entered
    // it as it entered the region around it, and it is owed nothing.
    let regions = vec![
        (0, files(&["a.test.ts", "b.test.ts"]), Vec::new()),
        (1, files(&["a.test.ts"]), Vec::new()),
        (2, files(&["a.test.ts"]), Vec::new()),
        (3, files(&["a.test.ts", "b.test.ts"]), Vec::new()),
    ];
    assert_eq!(modules, [("src/a.ts".to_owned(), true, regions)]);
    assert!(tests.iter().all(|(_, complete, _)| *complete));
    let reversed = combine_bytes(&named(&[&other, &one]), Some(&cut)).unwrap();
    assert_eq!(fixture::read(&reversed.bytes).1, modules, "either order folds to one description");
}

#[test]
fn owes_a_run_to_a_shard_whose_regions_have_no_place_in_the_cut() {
    let (_, other) = disputed();
    // The counters sit elsewhere: `g#1` is a seat the cut gives no region.
    let elsewhere = vec![block(0, &[0]), inside(1, "g#1", 0, &[0])];
    let one = fixture::write(&spec(vec![test("a.test.ts")], vec![module("src/a.ts", elsewhere)]));
    let cut = fixture::write(&spec(Vec::new(), vec![module("src/a.ts", cut_of_a())]));
    let (tests, modules) = fixture::read(&combine_bytes(&named(&[&one, &other]), Some(&cut)).unwrap().bytes);
    assert_eq!(tests.iter().map(|(file, complete, _)| (file.as_str(), *complete)).collect::<Vec<_>>(), [("a.test.ts", false), ("b.test.ts", true)]);
    assert_eq!(modules[0].2[3], (3, files(&["b.test.ts"]), Vec::new()));
}

#[test]
fn refuses_a_disputed_module_the_checkout_holds_at_another_text_or_not_at_all() {
    let (one, other) = disputed();
    let mut moved = module("src/a.ts", cut_of_a());
    moved.source = "text-2";
    let cut = fixture::write(&spec(Vec::new(), vec![moved]));
    let refusal = combine_bytes(&named(&[&one, &other]), Some(&cut)).err().unwrap();
    assert!(refusal.contains("`src/a.ts` region 2 is described differently by shard-0.bin and shard-1.bin"), "{refusal}");
    assert!(refusal.contains("the checkout holds `src/a.ts` at another text"), "{refusal}");
    let none = fixture::write(&spec(Vec::new(), Vec::new()));
    let refusal = combine_bytes(&named(&[&one, &other]), Some(&none)).err().unwrap();
    assert!(refusal.contains("the checkout holds no text of `src/a.ts`"), "{refusal}");
}
