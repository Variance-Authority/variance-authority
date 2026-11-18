//! A language's source roots, and which of them hold each top-level name. A
//! tree with a manifest per tool has hundreds of roots, and a name no root
//! holds — `os`, `java.util`, any library — would otherwise ask every one of
//! them for every candidate file. The index answers the same roots in the same
//! order as walking them all, minus those that cannot hold the name.

// compass: variance-authority.reach.source-scan

use std::collections::HashMap;

pub(crate) struct SourceRoots {
    pub(crate) order: Vec<String>,
    all: Vec<u32>,
    holding: HashMap<String, Vec<u32>>,
}

impl SourceRoots {
    /// Index `order` by what its roots hold: for every file ending in one of
    /// `extensions`, and every root above it, the name one step below that root
    /// — a directory, or the file's own name without its extension.
    pub(crate) fn of<'p>(order: Vec<String>, paths: impl Iterator<Item = &'p str>, extensions: &[&str]) -> Self {
        let at: HashMap<&str, u32> = order.iter().map(String::as_str).zip(0..).collect();
        let mut holding: HashMap<String, Vec<u32>> = HashMap::new();
        for path in paths.filter(|path| extensions.iter().any(|end| path.ends_with(end))) {
            let starts = std::iter::once(0).chain(path.match_indices('/').map(|(slash, _)| slash + 1));
            for start in starts {
                let directory = if start == 0 { "" } else { &path[..start - 1] };
                let Some(&root) = at.get(directory) else { continue };
                let rest = &path[start..];
                let top = match rest.split_once('/') {
                    Some((top, _)) => top,
                    None => extensions.iter().find_map(|end| rest.strip_suffix(end)).unwrap_or(rest),
                };
                holding.entry(top.to_owned()).or_default().push(root);
            }
        }
        for roots in holding.values_mut() {
            roots.sort_unstable();
            roots.dedup();
        }
        let all = (0..order.len() as u32).collect();
        Self { order, all, holding }
    }

    /// The roots that can hold a name starting with `top`, in root order. An
    /// empty `top` names the roots themselves, which every root can.
    pub(crate) fn holding<'s>(&'s self, top: &str) -> impl Iterator<Item = &'s str> + Clone + 's {
        let roots = if top.is_empty() { &self.all } else { self.holding.get(top).map_or(&[][..], Vec::as_slice) };
        roots.iter().map(|&root| self.order[root as usize].as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::SourceRoots;

    #[test]
    fn a_name_is_asked_only_of_the_roots_that_hold_it_in_root_order() {
        let order = vec![String::new(), "lib".to_owned(), "tools/x".to_owned()];
        let paths = ["lib/os_util.py", "lib/pkg/a.py", "pkg/b.py", "tools/x/pkg/c.py", "tools/x/README.md"];
        let roots = SourceRoots::of(order, paths.into_iter(), &[".py", ".pyi"]);
        assert_eq!(roots.holding("pkg").collect::<Vec<_>>(), ["", "lib", "tools/x"]);
        assert_eq!(roots.holding("os_util").collect::<Vec<_>>(), ["lib"]);
        assert_eq!(roots.holding("lib").collect::<Vec<_>>(), [""]);
        assert_eq!(roots.holding("README").count(), 0);
        assert_eq!(roots.holding("").count(), 3);
    }
}
