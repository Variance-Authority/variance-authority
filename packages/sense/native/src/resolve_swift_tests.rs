//! `where a Swift module name lands` in `swift.test.ts`, case for case.

use std::collections::HashMap;

use super::resolve;
use crate::world::World;

/// A `path:` that is not the default, because the default is only a default.
const MANIFEST: &str = "import PackageDescription\nlet package = Package(name: \"Shadow\", targets: [\n  .target(name: \"Core\", path: \"Sources/core\"),\n  .target(name: \"App\"),\n  .testTarget(name: \"CoreTests\"),\n])";

const TREE: [&str; 6] = [
    "Package.swift",
    "Sources/App/Main.swift",
    "Sources/core/Lens.swift",
    "Sources/core/deep/Seen.swift",
    "Tests/CoreTests/LensTests.swift",
    "scripts/loose.swift",
];

fn landed(from: &str, request: &str) -> Vec<String> {
    let known: HashMap<String, u32> = TREE.iter().map(|path| (*path).to_owned()).zip(0..).collect();
    let parsing = |paths: &[&str]| paths.iter().map(|_| None).collect();
    let texting = |path: &str| (path == "Package.swift").then(|| MANIFEST.to_owned());
    let world = World::new(Some(&known), None).reading(&parsing, &texting);
    resolve(&world, from, request)
}

#[cfg(feature = "grammars")]
#[test]
fn reads_the_manifest_as_the_program_it_is_path_and_all() {
    assert_eq!(landed("Sources/App/Main.swift", "Core"), ["Sources/core/Lens.swift", "Sources/core/deep/Seen.swift"]);
}

#[cfg(feature = "grammars")]
#[test]
fn gives_a_file_the_whole_of_its_own_target_at_any_depth() {
    assert_eq!(landed("Sources/core/Lens.swift", "*"), ["Sources/core/deep/Seen.swift"]);
}

#[test]
fn falls_back_to_swiftpm_defaults_for_a_target_that_spells_no_path() {
    assert_eq!(landed("Sources/core/Lens.swift", "CoreTests"), ["Tests/CoreTests/LensTests.swift"]);
}

#[test]
fn keeps_the_manifest_out_of_the_graph_it_describes() {
    assert!(landed("Package.swift", "*").is_empty());
}

#[test]
fn gives_a_file_no_package_claims_only_the_files_beside_it() {
    assert!(landed("scripts/loose.swift", "*").is_empty());
}
