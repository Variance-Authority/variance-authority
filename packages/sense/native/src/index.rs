//! The parse half of the existing source-index generation format: the layer a
//! graph walk's own reads become, published beside the generation that holds
//! the records.

// compass: variance-authority.reach.source-index

use crate::generation::{encode_generation, Deleted, Generation};
use crate::order;
use crate::parse_columns::{ParseColumns, ParseRow};
use crate::read::Read;
use crate::segment::{Collected, Strings};

/// A complete generation containing parses and empty values for every other
/// source-index layer. A following generation may carry records and tree shape;
/// the existing immutable-log reader already folds those layers together.
///
/// Every column the decoder names has to be here, including the ones this half
/// never has rows for. An absent section is not an empty one: the decoder
/// rejects the segment that omits it, and a rejected segment rejects the whole
/// chain it was committed with — the records of the generation published beside
/// it included.
pub fn parse_segment(
    files: &[String],
    digests: &[String],
    reads: &[(Read, String, bool)],
) -> Vec<u8> {
    let mut rows: Vec<(String, usize)> = files
        .iter()
        .zip(digests)
        .zip(reads)
        .enumerate()
        .filter(|(_, (_, (_, _, parsed)))| *parsed)
        .map(|(index, ((file, digest), _))| (format!("{digest}\0{}", way(file)), index))
        .collect();
    rows.sort_unstable_by(|left, right| order::code_unit(&left.0, &right.0));
    rows.dedup_by(|left, right| left.0 == right.0);
    let rows: Vec<(&str, &Read)> = rows.iter().map(|(key, index)| (key.as_str(), &reads[*index].0)).collect();
    parses_only(&rows)
}

/// The generation for parse rows alone, keyed and sorted by the caller.
pub(crate) fn parses_only<P: ParseRow>(rows: &[(&str, &P)]) -> Vec<u8> {
    encode_generation(&Generation { config: None, directories: &[], parses: rows, records: &[], deleted: Deleted::default() })
}

/// A walk's read, as a parse row: an empty list is how a `Read` says a list
/// is absent, so presence is non-emptiness — what JavaScript's `harvested`
/// path has always written for these keys.
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
        for export in &self.exports {
            for value in [&export.exported, &export.local, &export.from, &export.imported].into_iter().flatten() {
                values.insert(value);
            }
        }
        for symbol in &self.symbols {
            values.insert(&symbol.name);
            values.insert(symbol.kind);
        }
        values.extend(self.declares.iter().map(String::as_str));
        values.extend(self.mocks.minus.iter().map(String::as_str));
        values.extend(self.mocks.plus.iter().map(String::as_str));
        values.extend(self.members.iter().map(|member| member.name.as_str()));
        values.extend(self.unknown.as_deref());
    }

    fn write(&self, strings: &Strings, into: &mut ParseColumns) {
        let id = |value: &str| strings.id(value);
        for request in &self.requests {
            into.request(
                id(&request.value),
                id(request.kind.as_str()),
                request.line,
                request.bindings.iter().map(|binding| {
                    (id(&binding.imported), id(&binding.local), binding.type_only, binding.line)
                }),
            );
        }
        let span = |span: Option<crate::harvest::TextSpan>| span.map(|span| (span.start, span.end));
        for export in &self.exports {
            into.export(
                [&export.exported, &export.local, &export.from, &export.imported]
                    .map(|value| strings.optional(value.as_deref())),
                export.type_only,
                export.line,
                span(export.signature),
                span(export.doc),
            );
        }
        for symbol in &self.symbols {
            into.symbol(id(&symbol.name), id(symbol.kind), symbol.line, span(symbol.signature), span(symbol.doc));
        }
        for name in &self.declares {
            into.declare(id(name));
        }
        into.mock(self.mocks.minus.iter().map(|value| id(value)), self.mocks.plus.iter().map(|value| id(value)));
        for member in &self.members {
            into.member(member.request, id(&member.name), member.line);
        }
    }

    fn exports_present(&self) -> bool {
        !self.exports.is_empty()
    }

    fn declares_present(&self) -> bool {
        !self.declares.is_empty()
    }

    fn unknown(&self) -> Option<&str> {
        self.unknown.as_deref()
    }

    fn harvested(&self) -> bool {
        self.harvested
    }
}

/// What the path says about reading it: `parseWay` and the second half of
/// `keyFor` in `files.ts`.
pub(crate) fn way(file: &str) -> String {
    let name = file.rsplit('/').next().unwrap_or(file);
    let suffix = name
        .char_indices()
        .skip(1)
        .find(|(_, value)| *value == '.')
        .map_or("", |(at, _)| &name[at..]);
    let declaring = ![".test.", ".spec.", ".stories.", ".d.ts"]
        .iter()
        .any(|part| file.contains(part));
    format!("{suffix}\0{}", if declaring { "+" } else { "-" })
}
