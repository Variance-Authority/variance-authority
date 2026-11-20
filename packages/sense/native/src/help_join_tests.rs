// compass: variance-authority.report.agent-surface

use super::*;
use crate::help_names::ReachedDeclaration;

fn declared(name: &str, kinds: &[&str]) -> PublishedName {
    let kinds = kinds
        .iter()
        .map(|kind| ReachedDeclaration { kind: (*kind).to_owned(), at: "a.ts".to_owned(), line: 1, signature: None, doc: Some("Doc.".to_owned()), declared: name.to_owned() })
        .collect();
    PublishedName { name: name.to_owned(), kinds }
}

/// Packages of openings of names: `a` with two openings, `b` with none, `c`
/// with one opening of three names and `d` with an opening of no names.
fn packages() -> (Vec<(&'static str, Vec<&'static str>)>, Vec<Vec<PublishedName>>) {
    let skeleton = vec![("a", vec![".", "./x"]), ("b", vec![]), ("c", vec!["."]), ("d", vec!["."])];
    let names = vec![
        vec![declared("one", &["function"])],
        vec![declared("two", &["type", "const"])],
        vec![declared("three", &["const"]), declared("four", &["class", "interface"]), declared("five", &["type"])],
        vec![],
    ];
    (skeleton, names)
}

fn skeleton_of<'a>(held: &'a [(&'static str, Vec<&'static str>)]) -> Vec<Skeleton<'a>> {
    held.iter()
        .map(|(name, openings)| Skeleton { name, entry: true, openings: openings.iter().map(|subpath| OpeningSkeleton { subpath, source: "a.ts", spec: name }).collect() })
        .collect()
}

/// Each run's packages, as `package subpath: name kind, ...` lines.
fn visited(joined: &Joined) -> Vec<Vec<String>> {
    let mut runs = Vec::new();
    joined.each(&mut |run| {
        let lines = run.iter().flat_map(|owner| {
            let openings = owner.openings.iter().map(move |opening| {
                let entries: Vec<String> = opening.entries.iter().map(|entry| format!("{} {}", entry.name, entry.kind)).collect();
                format!("{} {}: {}", owner.name, opening.subpath, entries.join(", "))
            });
            std::iter::once(owner.name.to_owned()).chain(openings)
        });
        runs.push(lines.collect());
    });
    runs
}

#[test]
fn runs_of_any_size_visit_the_packages_one_run_visits_and_close_at_the_first_package_that_fills_them() {
    let (held, names) = packages();
    let mentions = Mentions::new();
    let once = visited(&Joined::new(skeleton_of(&held), &names, &[], &mentions).unwrap());
    assert_eq!(once, [vec!["a", "a .: one function", "a ./x: two const+type", "b", "c", "c .: five type, four class+interface, three const", "d", "d .: "]]);
    for (run, expected) in [(1, vec![vec!["a"], vec!["b", "c"], vec!["d"]]), (2, vec![vec!["a"], vec!["b", "c"], vec!["d"]]), (4, vec![vec!["a", "b", "c"], vec!["d"]])] {
        let runs = visited(&Joined::new(skeleton_of(&held), &names, &[], &mentions).unwrap().in_runs_of(run));
        assert_eq!(runs.concat(), once[0], "runs of {run}");
        let owners: Vec<Vec<&str>> = runs.iter().map(|lines| lines.iter().filter(|line| !line.contains(':')).map(String::as_str).collect()).collect();
        assert_eq!(owners, expected, "runs of {run}");
    }
}

#[test]
fn a_name_with_no_declaration_is_refused_when_the_join_is_built() {
    let (held, mut names) = packages();
    names[2][1].kinds.clear();
    let mentions = Mentions::new();
    let refused = Joined::new(skeleton_of(&held), &names, &[], &mentions).err();
    assert_eq!(refused.as_deref(), Some("`four` was reached with no declaration behind it"));
}
