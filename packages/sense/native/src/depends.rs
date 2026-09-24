//! `/// <depends path="./schema.graphql" />`: a file a module reads without
//! importing it — a schema a mock server loads, a fixture read through `fs`.
//! Nothing in the module's syntax names that file, so its author does, in the
//! shape TypeScript already gives a file-level directive. TypeScript reads an
//! unknown tag as a comment, and so does every runtime; only this reader turns
//! it into a request, and the request is resolved like any other.
//!
//! The path is relative to the file that declares it, as a `reference path`
//! is, so `schema.graphql` and `./schema.graphql` name the same file.

use oxc_ast::ast::Comment;

use crate::read::{Kind, Lines, Request};

pub(crate) struct Depends {
    pub requests: Vec<Request>,
    /// Directives that name no path, which the caller reports rather than drops.
    pub pathless: usize,
}

pub(crate) fn depends_in(source: &str, comments: &[Comment], lines: &Lines) -> Depends {
    let mut found = Depends { requests: Vec::new(), pathless: 0 };
    for comment in comments.iter().filter(|comment| comment.is_line()) {
        let span = comment.content_span();
        match directive(&source[span.start as usize..span.end as usize]) {
            Some(Some(path)) => found.requests.push(Request {
                value: path,
                kind: Kind::Depends,
                bindings: Vec::new(),
                line: lines.at(comment.span.start),
            }),
            Some(None) => found.pathless += 1,
            None => {}
        }
    }
    found
}

/// The path a line comment's text declares: `None` when it is not a
/// `<depends>` directive, `Some(None)` when it is one without a path.
fn directive(content: &str) -> Option<Option<String>> {
    let tag = content.strip_prefix('/')?.trim_start().strip_prefix("<depends")?;
    if !tag.starts_with(|c: char| c.is_whitespace() || c == '/' || c == '>') {
        return None;
    }
    Some(path_of(tag).map(|path| {
        if path.starts_with('.') || path.starts_with('/') { path.to_owned() } else { format!("./{path}") }
    }))
}

fn path_of(tag: &str) -> Option<&str> {
    let mut from = 0;
    while let Some(found) = tag[from..].find("path") {
        let at = from + found;
        from = at + "path".len();
        if !tag[..at].ends_with(char::is_whitespace) {
            continue;
        }
        let Some(value) = tag[from..].trim_start().strip_prefix('=') else { continue };
        let value = value.trim_start();
        let quote = value.chars().next().filter(|quote| *quote == '"' || *quote == '\'')?;
        let inner = &value[1..];
        return inner.find(quote).map(|end| &inner[..end]).filter(|path| !path.is_empty());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::directive;

    #[test]
    fn reads_the_path_a_directive_names() {
        assert_eq!(directive("/ <depends path=\"./schema.graphql\" />"), Some(Some("./schema.graphql".to_owned())));
        assert_eq!(directive("/<depends path='data/rows.json'/>"), Some(Some("./data/rows.json".to_owned())));
        assert_eq!(directive("/ <depends  path = \"../shared.json\" />"), Some(Some("../shared.json".to_owned())));
    }

    #[test]
    fn a_tag_without_a_path_is_a_directive_that_names_nothing() {
        assert_eq!(directive("/ <depends />"), Some(None));
        assert_eq!(directive("/ <depends filepath=\"x.json\" />"), Some(None));
        assert_eq!(directive("/ <depends path=\"\" />"), Some(None));
    }

    #[test]
    fn anything_else_is_a_comment() {
        assert_eq!(directive(" <depends path=\"x.json\" />"), None);
        assert_eq!(directive("/ <reference path=\"x.d.ts\" />"), None);
        assert_eq!(directive("/ <dependson path=\"x.json\" />"), None);
    }
}
