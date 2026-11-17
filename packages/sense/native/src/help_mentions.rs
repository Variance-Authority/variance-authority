//! README mentions for source declarations, with one document read per publication.

// compass: variance-authority.report.agent-surface

use std::collections::HashMap;
use std::path::Path;
use crate::help_store::StoreMention;

pub(crate) struct Readmes<'a> { root: &'a str, held: HashMap<String, Result<Option<String>, String>> }

impl<'a> Readmes<'a> {
    pub(crate) fn new(root: &'a str) -> Self { Self { root, held: HashMap::new() } }

    pub(crate) fn mention(&mut self, at: &str, name: &str) -> Result<Option<StoreMention>, String> {
        let parts: Vec<_> = at.split('/').collect();
        for depth in (0..parts.len()).rev() {
            let from = if depth == 0 { "README.md".to_owned() } else { format!("{}/README.md", parts[..depth].join("/")) };
            let source = self.held.entry(from.clone()).or_insert_with(|| {
                let file = Path::new(self.root).join(&from);
                match std::fs::read(&file) {
                    Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                    Err(error) => Err(format!("cannot read {}: {error}", file.display())),
                }
            });
            if let Some(source) = source.as_ref().map_err(Clone::clone)? { return Ok(mention(source, &from, name)); }
        }
        Ok(None)
    }
}

fn find(text: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    text.get(from..)?.windows(needle.len()).position(|value| value == needle).map(|at| at + from)
}

fn rfind(text: &[u16], needle: &[u16], through: usize) -> Option<usize> {
    text.windows(needle.len()).enumerate().take(through.saturating_add(1)).filter_map(|(at, value)| (value == needle).then_some(at)).last()
}

fn fences(text: &[u16]) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut from = 0;
    while let Some(open) = find(text, &[96, 96, 96], from) {
        let close = find(text, &[96, 96, 96], open + 3).map_or(text.len(), |at| at + 3);
        spans.push((open, close));
        from = close;
    }
    spans
}

fn word(unit: u16) -> bool { matches!(unit, 36 | 48..=57 | 65..=90 | 95 | 97..=122) }

/// The package reader's whole-word, prose-before-code README passage.
fn mention(source: &str, from: &str, name: &str) -> Option<StoreMention> {
    let text: Vec<u16> = source.encode_utf16().collect();
    let name: Vec<u16> = name.encode_utf16().collect();
    if name.is_empty() { return None; }
    let spans = fences(&text);
    let mut best: Option<(u8, usize)> = None;
    let mut next = 0;
    while let Some(at) = find(&text, &name, next) {
        next = at + 1;
        if at.checked_sub(1).and_then(|at| text.get(at)).is_some_and(|unit| word(*unit)) || text.get(at + name.len()).is_some_and(|unit| word(*unit)) { continue; }
        let fenced = spans.iter().any(|(open, close)| *open <= at && at < *close);
        let quoted = at.checked_sub(1).and_then(|at| text.get(at)) == Some(&96) || text.get(at + name.len()) == Some(&96);
        let rank = if fenced { 2 } else if quoted { 0 } else { 1 };
        if best.is_none_or(|held| (rank, at) < held) { best = Some((rank, at)); }
    }
    let (_, hit) = best?;
    let (from_at, to) = match spans.iter().find(|(open, close)| *open <= hit && hit < *close) {
        Some((open, close)) => (rfind(&text, &[10], *open).map_or(0, |at| at + 1), *close),
        None => (rfind(&text, &[10, 10], hit).map_or(0, |at| at + 2), find(&text, &[10, 10], hit).unwrap_or(text.len())),
    };
    let (head, tail) = if to - from_at <= 1200 { (from_at, to) } else {
        let opened = from_at.max(hit.saturating_sub(600).min(to - 1200));
        let closed = to.min(opened + 1200);
        let head = if opened == from_at { from_at } else { find(&text, &[10], opened).map_or(0, |at| at + 1) };
        let tail = if closed == to { to } else { rfind(&text, &[10], closed).unwrap_or(text.len().saturating_sub(1)) };
        (head, tail)
    };
    let passage = String::from_utf16_lossy(text.get(head..tail).unwrap_or(&[]));
    let shown = format!("{}{}{}", if head > from_at { "…\n" } else { "" }, passage.trim_matches(|c: char| matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')), if tail < to { "\n…" } else { "" });
    Some(StoreMention { at: from.to_owned(), line: 1 + text[..head].iter().filter(|unit| **unit == 10).count() as u32, text: shown })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoted_prose_wins_over_bare_prose_and_code_without_substring_hits() {
        let text = "named is here.\n\n```ts\nnamed()\n```\n\nUse `named` here.";
        let read = mention(text, "README.md", "named").unwrap();
        assert_eq!((read.line, read.text.as_str()), (7, "Use `named` here."));
        assert!(mention("measurements", "README.md", "measure").is_none());
    }

    #[test]
    fn an_unreadable_nearest_readme_is_refused_and_an_unmentioned_nearest_one_stops() {
        let root = std::env::temp_dir().join(format!("sense-help-mentions-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/README.md")).unwrap();
        std::fs::write(root.join("README.md"), "Use `named`.").unwrap();
        let root_text = root.to_str().unwrap();
        assert!(Readmes::new(root_text).mention("src/a.ts", "named").is_err());
        std::fs::remove_dir(root.join("src/README.md")).unwrap();
        std::fs::write(root.join("src/README.md"), "Other prose.").unwrap();
        assert!(Readmes::new(root_text).mention("src/a.ts", "named").unwrap().is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
