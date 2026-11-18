//! Request spellings retain the resolver's path semantics at the listing boundary.

use std::cell::Cell;
use oxc_resolver::FileSystemOs;
use super::Emitted;
use crate::resolve::{Resolvers, Tsconfig};

#[test]
fn listed_resolution_preserves_the_six_noncanonical_requests() {
    let root = crate::git_fixture::repository("listed-request-spellings", &[
        ("tsconfig.json", br#"{"compilerOptions":{"baseUrl":".","paths":{
            "rest/*":["help-center/src/rest/*"],"routes/*":["help-center/src/routes/*"],
            "@atlassian/editor-plugin-ai/*":["platform/packages/editor/editor-plugin-ai/*"],
            "@atlaskit/editor-plugin-card/*":["platform/packages/editor/editor-plugin-card/*"],
            "@atlaskit/editor-plugin-media/*":["platform/packages/editor/editor-plugin-media/*"]}}}"#),
        ("entry-a.ts", b"export {};\n"),
        ("entry-b.ts", b"export {};\n"),
        ("help-center/src/rest/user/pact/mock/index.tsx", b"export {};\n"),
        ("help-center/src/routes/portal-reorder/resources/index.tsx", b"export {};\n"),
        ("platform/packages/editor/editor-plugin-ai/src/ui/prebuilt/config-items/prompts/enhance/enhance.tsx", b"export {};\n"),
        ("platform/packages/editor/editor-plugin-card/src/pm-plugins/util/state.ts", b"export {};\n"),
        ("platform/packages/editor/editor-plugin-media/src/ui/MediaPicker/PickerFacadeProvider.tsx", b"export {};\n"),
    ]);
    let tree = crate::git_tree::git_tree(root.to_str().unwrap().to_owned()).unwrap();
    let open = Resolvers::new(Tsconfig::Auto, None);
    let listed = Resolvers::over(Tsconfig::Auto, None, Emitted::listed(&root, Some(tree.listing())));
    let cases = [
        ("entry-a.ts", "rest/user/pact/mock/", "help-center/src/rest/user/pact/mock/index.tsx"),
        ("entry-a.ts", "routes/portal-reorder/resources/", "help-center/src/routes/portal-reorder/resources/index.tsx"),
        ("entry-a.ts", "@atlassian/editor-plugin-ai/src/ui/prebuilt/../prebuilt/config-items/prompts/enhance/enhance", "platform/packages/editor/editor-plugin-ai/src/ui/prebuilt/config-items/prompts/enhance/enhance.tsx"),
        ("entry-a.ts", "@atlaskit/editor-plugin-card/src/pm-plugins//util/state", "platform/packages/editor/editor-plugin-card/src/pm-plugins/util/state.ts"),
        ("entry-b.ts", "@atlaskit/editor-plugin-card/src/pm-plugins//util/state", "platform/packages/editor/editor-plugin-card/src/pm-plugins/util/state.ts"),
        ("entry-a.ts", "@atlaskit/editor-plugin-media/src//ui/MediaPicker/PickerFacadeProvider", "platform/packages/editor/editor-plugin-media/src/ui/MediaPicker/PickerFacadeProvider.tsx"),
    ];
    for (importer, request, target) in cases {
        let from = root.join(importer);
        assert_eq!(open.resolve(&root, &from, request, None).as_deref(), Some(target), "open resolver: {request}");
        assert_eq!(listed.resolve(&root, &from, request, Some(tree.at.as_ref())).as_deref(), Some(target), "listed resolver: {request}");
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_parent_component_after_a_symbolic_directory_keeps_the_filesystem_answer() {
    let root = crate::git_fixture::repository("listed-symbolic-parent", &[
        ("source/entry.ts", b"export {};\n"),
        ("elsewhere/deep/kept.ts", b"export {};\n"),
        ("elsewhere/missing/actual.ts", b"export {};\n"),
    ]);
    std::os::unix::fs::symlink("../elsewhere/deep", root.join("source/linked")).unwrap();
    crate::git_fixture::commit(&root);
    let tree = crate::git_tree::git_tree(root.to_str().unwrap().to_owned()).unwrap();
    let scan = Emitted::listed(&root, Some(tree.listing()));
    let candidate = root.join("source/linked/../missing/actual.ts");
    let called = Cell::new(false);
    let answer = scan.disk_metadata(&candidate, |path| { called.set(true); FileSystemOs::metadata(path) }).unwrap();
    assert!(called.get() && answer.is_file(), "the OS resolves .. after following the link");
    let from = root.join("source/entry.ts");
    let request = "./linked/../missing/actual.ts";
    let open = Resolvers::new(Tsconfig::Off, None).resolve(&root, &from, request, None);
    let listed = Resolvers::over(Tsconfig::Off, None, scan).resolve(&root, &from, request, Some(tree.at.as_ref()));
    assert_eq!(listed, open, "the resolver owns the meaning of parent components in requests");
    std::fs::remove_dir_all(root).unwrap();
}
