//! Tree-sitter reader facts written directly into the shared source-index columns.

// compass: variance-authority.reach.source-index

use crate::languages::shape::Read;
use crate::parse_columns::{ParseColumns, ParseRow, Span};
use crate::segment::{Collected, Strings};

impl ParseRow for Read {
    fn strings<'s>(&'s self, values: &mut Collected<'s>) {
        for request in &self.requests {
            values.insert(&request.value);
            values.insert(request.kind.as_str());
            for binding in &request.bindings {
                values.insert(&binding.imported);
                values.insert(&binding.local);
            }
        }
        for export in self.exports.iter().flatten() {
            values.extend([&export.exported, &export.local, &export.from, &export.imported].into_iter().flatten().map(String::as_str));
        }
        for symbol in &self.symbols {
            values.insert(&symbol.name);
            values.insert(symbol.kind);
        }
        values.extend(self.own_uses.iter().map(|used| used.name.as_str()));
        values.extend(self.unknown.as_deref());
    }

    fn write<'text>(&'text self, strings: &Strings, into: &mut ParseColumns<'text>) {
        let id = |value: &str| strings.id(value);
        for request in &self.requests {
            into.request(id(&request.value), id(request.kind.as_str()), request.line,
                crate::parse_columns::request_flags(request.guessed, request.item), false,
                request.bindings.iter().map(|binding| (id(&binding.imported), id(&binding.local), binding.type_only, binding.line)));
        }
        for export in self.exports.iter().flatten() {
            into.export([&export.exported, &export.local, &export.from, &export.imported].map(|value| strings.optional(value.as_deref())),
                export.type_only, export.line, None, None, 0, export.line_text.as_deref());
        }
        for symbol in &self.symbols {
            into.symbol(id(&symbol.name), id(symbol.kind), symbol.line, raw(&symbol.signature), raw(&symbol.doc), crate::harvest::reach_code(symbol.reach));
        }
        into.mock(std::iter::empty(), std::iter::empty());
        for used in &self.own_uses { into.own_use(id(&used.name), used.line); }
    }

    fn exports_present(&self) -> bool { self.exports.is_some() }
    fn declares_present(&self) -> bool { false }
    fn unknown(&self) -> Option<&str> { self.unknown.as_deref() }
    fn harvested(&self) -> bool { self.harvested }
    fn size(&self) -> Option<crate::source_size::Size> { self.size }
    fn doc(&self) -> Span<'_> { None }
    fn words(&self, item: crate::name_table::Item, at: usize) -> Option<Option<std::borrow::Cow<'_, str>>> {
        let doc = match item {
            crate::name_table::Item::Symbol => self.symbols.get(at).and_then(|symbol| symbol.doc.as_ref()),
            _ => None,
        };
        crate::parse_columns::words_at(doc.map(|doc| doc.text.as_deref()))
    }
}

fn raw(span: &Option<crate::harvest::TextSpan>) -> Span<'_> {
    span.as_ref().map(|span| (span.start, span.end, span.text.as_deref()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_language_rows_match_the_existing_binary_encoder() {
        for (language, file, source) in [
            ("rust", "src/lib.rs", "/// 文😀\npub struct Named;\nmod other;\nfn call() { crate::other::run(); }\n"),
            ("python", "main.py", "from other import named\n\ndef call():\n    \"\"\"文😀\"\"\"\n    return named()\n"),
            ("java", "Named.java", "package kit;\nimport other.Named;\n/** 文😀 */\npublic class Kit {}\n"),
            ("kotlin", "Named.kt", "package kit\nimport other.Named\n/** 文😀 */\nclass Kit\n"),
            ("swift", "Named.swift", "import Other\n/// 文😀\npublic struct Named {}\n"),
        ] {
            let mut read = crate::languages::read(language, file, source).unwrap();
            for exports in [read.exports.clone(), Some(Vec::new()), None] {
                read.exports = exports;
                let held: crate::held::HeldParse = serde_json::from_value(serde_json::to_value(&read).unwrap()).unwrap();
                let key = format!("digest\0{}", crate::index::way(file));
                assert_eq!(crate::index::parses_only(&[(&key, &read)]), crate::index::parses_only(&[(&key, &held)]), "{language}");
            }
        }
    }
}
