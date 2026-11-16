//! Stylesheet requests, read once in the native acquisition wave.

// compass: variance-authority.reach.source-index

use std::sync::LazyLock;

use regex::Regex;

use crate::read::{Kind, Lines, Read, Request};

const EXTENSIONS: [&str; 4] = [".css", ".scss", ".sass", ".less"];

static PATTERNS: LazyLock<[Regex; 3]> = LazyLock::new(|| [
    r#"@(?:import|use|forward)\s+(?:url\(\s*)?(?:'([^']*)'|"([^"]*)")"#,
    r#"(?-u:\b)url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"]+))\s*\)"#,
    r#"(?-u:\b)composes\s*:[^;]*?(?-u:\b)from\s+(?:'([^']*)'|"([^"]*)")"#,
].map(|pattern| Regex::new(pattern).expect("stylesheet request pattern")));

pub(crate) fn is_style(file: &str) -> bool {
    EXTENSIONS.iter().any(|extension| file.ends_with(extension))
}

pub(crate) fn read(_file: &str, source: &str) -> Read {
    let lines = Lines::new(source);
    let mut requests = Vec::new();
    for pattern in PATTERNS.iter() {
        for captures in pattern.captures_iter(source) {
            let Some(value) = captures.iter().skip(1).flatten().next() else { continue };
            let value = value.as_str().trim();
            if value.is_empty() || ["data:", "http:", "https:", "//", "#"].iter().any(|prefix| value.starts_with(prefix)) { continue }
            requests.push(Request {
                value: value.to_owned(), kind: Kind::Asset, bindings: Vec::new(),
                line: lines.at(captures.get(0).unwrap().start() as u32), republishes: false,
            });
        }
    }
    Read { requests, harvested: true, ..Read::default() }
}

pub(crate) fn requests(request: &str) -> Vec<String> {
    let bare = request.strip_prefix('~').unwrap_or(request);
    let at = bare.rfind('/').map_or(0, |at| at + 1);
    let partial = format!("{}_{}", &bare[..at], &bare[at..]);
    let mut attempts = vec![bare.to_owned(), partial];
    if bare != request { attempts.push(request.to_owned()); }
    attempts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_stylesheet_request_order_duplicates_and_lines() {
        let source = "/* @use './comment'; */\n@import url('./token');\na { background: url( ./image.svg ); composes: other from './other.css'; }\nurl(#gradient); url(https://example.com/a);";
        let read = read("token.scss", source);
        assert!(read.harvested);
        assert!(read.unknown.is_none());
        assert!(read.symbols.is_empty());
        assert_eq!(read.requests.iter().map(|request| (request.value.as_str(), request.kind.as_str(), request.line)).collect::<Vec<_>>(),
            vec![("./comment", "asset", 1), ("./token", "asset", 2), ("./token", "asset", 2), ("./image.svg", "asset", 3), ("./other.css", "asset", 3)]);
    }

    #[test]
    fn tries_sass_partial_and_webpack_forms_in_order() {
        assert_eq!(requests("./token"), ["./token", "./_token"]);
        assert_eq!(requests("~kit/token"), ["kit/token", "kit/_token", "~kit/token"]);
    }

    #[test]
    fn resolves_styles_before_modules_and_uses_module_aliases_after_styles() {
        let root = std::env::temp_dir().join(format!("sense-style-resolve-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        for (file, source) in [
            ("entry.scss", "@use './token';"),
            ("_token.scss", "$color: red;"),
            ("token.ts", "export const color = 'red';"),
            ("aliased.css", "a {}"),
            ("tsconfig.json", r#"{"compilerOptions":{"baseUrl":".","paths":{"theme":["aliased.css"]}}}"#),
        ] { std::fs::write(root.join(file), source).unwrap(); }
        let root = std::fs::canonicalize(root).unwrap();
        let resolver = crate::resolve::Resolvers::new(crate::resolve::Tsconfig::Named(root.join("tsconfig.json")), None);
        assert_eq!(resolver.resolve_style(&root, &root.join("entry.scss"), "./token?raw", None).as_deref(), Some("_token.scss"));
        assert_eq!(resolver.resolve_style(&root, &root.join("entry.scss"), "theme", None).as_deref(), Some("aliased.css"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
