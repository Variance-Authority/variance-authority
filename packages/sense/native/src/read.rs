//! One module's cacheable facts, extracted without letting its AST cross N-API.

use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use oxc_syntax::module_record::{ExportExportName, ExportImportName, ImportImportName};
use serde::Serialize;

use crate::declarations::declarations;
use crate::declared_role::DeclaredRoles;
use crate::harvest::{Harvest, SourceSymbol, TextSpan};
use crate::members::{members_and_loads_in, Member};
use crate::mocks::{mocks_in, Mocks};
use crate::source_size::{size_of, Size};

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Imports = 0,
    Reexports,
    Dynamic,
    Type,
    Depends,
}

impl Kind {
    pub const ALL: [Kind; 5] = [Kind::Imports, Kind::Reexports, Kind::Dynamic, Kind::Type, Kind::Depends];
    pub fn code(self) -> u8 {
        self as u8
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Imports => "imports",
            Self::Reexports => "reexports",
            Self::Dynamic => "dynamic",
            Self::Type => "type",
            Self::Depends => "depends",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Binding {
    pub(crate) imported: String,
    pub(crate) local: String,
    #[serde(rename = "type")]
    pub(crate) type_only: bool,
    pub(crate) line: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct Request {
    pub value: String,
    pub kind: Kind,
    pub(crate) bindings: Vec<Binding>,
    pub(crate) line: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct Export {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) exported: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) local: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) imported: Option<String>,
    #[serde(rename = "type")]
    pub(crate) type_only: bool,
    pub(crate) line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) signature: Option<TextSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) doc: Option<TextSpan>,
    /// The role tags its doc declares, as `declared_role` bits.
    #[serde(rename = "roles", skip_serializing_if = "is_zero", serialize_with = "crate::declared_role::serialize")]
    pub(crate) tags: u8,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Read {
    pub requests: Vec<Request>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) exports: Vec<Export>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) symbols: Vec<SourceSymbol>,
    #[serde(skip_serializing_if = "is_false")]
    pub(crate) harvested: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) declares: Vec<String>,
    #[serde(skip_serializing_if = "Mocks::is_empty")]
    pub(crate) mocks: Mocks,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) members: Vec<Member>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) size: Option<Size>,
}

pub(crate) struct Lines(Vec<usize>);

impl Lines {
    fn new(source: &str) -> Self {
        let mut starts = vec![0];
        starts.extend(source.match_indices('\n').map(|(at, _)| at + 1));
        Self(starts)
    }

    pub(crate) fn at(&self, offset: u32) -> u32 {
        self.0.partition_point(|start| *start <= offset as usize) as u32
    }
}

struct ImportGroup {
    at: u32,
    value: String,
    bindings: Vec<Binding>,
}

struct ReexportGroup {
    value: String,
    bindings: Vec<Binding>,
    only_types: bool,
    line: u32,
}

/// The dialect a source file is read in.
///
/// The extension alone leaves JSX off for `.js`, `.mjs` and `.cjs`, where most
/// React components written in JavaScript live, and an element there is a parse
/// error that leaves the file with no edges. Only those three are widened: `.ts`
/// keeps its own dialect, because `<string>value` is a cast there.
pub fn dialect(file: &str) -> Option<SourceType> {
    let source_type = SourceType::from_path(file).ok()?;
    let widened = [".js", ".mjs", ".cjs"].iter().any(|end| file.ends_with(end));
    Some(if widened { source_type.with_jsx(true) } else { source_type })
}

/// One module's `Parsed` value, from OXC's native module record.
pub fn read_module(file: &str, source: &str, allocator: &Allocator, symbols: bool) -> Read {
    let source_type = dialect(file).unwrap_or_else(SourceType::tsx);
    let parsed = Parser::new(allocator, source, source_type).parse();
    let record = &parsed.module_record;
    let lines = Lines::new(source);
    let mut harvest = Harvest::new(&parsed.program, source, &lines, symbols);
    let roles = DeclaredRoles::new(&parsed.program, std::mem::take(&mut harvest.tagged));
    let mut requests = Vec::new();
    let mut imports: Vec<ImportGroup> = Vec::new();
    // A request's kind is the statement's keyword and never its names, for the
    // reason `read.ts` gives; the record keeps that keyword per statement.
    let mut typed: Vec<u32> = record
        .requested_modules
        .values()
        .flatten()
        .filter(|occurrence| occurrence.is_type)
        .map(|occurrence| occurrence.statement_span.start)
        .collect();
    typed.sort_unstable();
    let declared_type = |at: u32| typed.binary_search(&at).is_ok();

    for entry in &record.import_entries {
        let at = entry.statement_span.start;
        let binding = Binding {
            imported: import_name(&entry.import_name),
            local: entry.local_name.name.to_string(),
            type_only: entry.is_type,
            line: lines.at(at),
        };
        match imports.last_mut() {
            Some(group) if group.at == at => group.bindings.push(binding),
            _ => imports.push(ImportGroup {
                at,
                value: entry.module_request.name.to_string(),
                bindings: vec![binding],
            }),
        }
    }

    let claimed: Vec<u32> = imports.iter().map(|group| group.at).collect();
    for (specifier, occurrences) in &record.requested_modules {
        for occurrence in occurrences {
            if occurrence.is_import
                && claimed
                    .binary_search(&occurrence.statement_span.start)
                    .is_err()
            {
                imports.push(ImportGroup {
                    at: occurrence.statement_span.start,
                    value: specifier.to_string(),
                    bindings: Vec::new(),
                });
            }
        }
    }
    imports.sort_by_key(|group| group.at);
    requests.extend(imports.into_iter().map(|group| Request {
        value: group.value,
        kind: if declared_type(group.at) {
            Kind::Type
        } else {
            Kind::Imports
        },
        bindings: group.bindings,
        line: lines.at(group.at),
    }));

    let mut entries: Vec<_> = record
        .local_export_entries
        .iter()
        .chain(record.indirect_export_entries.iter())
        .chain(record.star_export_entries.iter())
        .collect();
    entries.sort_by_key(|entry| (entry.statement_span.start, entry.span.start));

    let mut exports = Vec::with_capacity(entries.len());
    let mut republished: Vec<ReexportGroup> = Vec::new();
    let mut groups: HashMap<String, usize> = HashMap::new();
    for entry in entries {
        let line = lines.at(entry.statement_span.start);
        let from = entry
            .module_request
            .as_ref()
            .map(|name| name.name.to_string());
        let exported = export_name(&entry.export_name);
        let imported = source_name(&entry.import_name);
        // The record's own bound name, which for `export default name` is
        // `name`: `exported` already says `default`, and the identifier is what
        // a reader follows through this file's imports to where it comes from.
        let local = entry.local_name.name().map(|name| name.to_string());

        let tags = roles.of(entry.statement_span.start, local.as_deref());
        exports.push(Export {
            exported: exported.clone(),
            local,
            from: from.clone(),
            imported: imported.clone(),
            type_only: entry.is_type,
            line,
            signature: Some(harvest.span(entry.statement_span)),
            doc: harvest.doc(entry.statement_span.start),
            tags,
        });

        let Some(value) = from else { continue };
        let group = match groups.get(&value) {
            Some(index) => *index,
            None => {
                let index = republished.len();
                groups.insert(value.clone(), index);
                republished.push(ReexportGroup {
                    value,
                    bindings: Vec::new(),
                    only_types: true,
                    line,
                });
                index
            }
        };
        let held = &mut republished[group];
        held.only_types &= declared_type(entry.statement_span.start);
        if let (Some(local), Some(imported)) = (exported, imported) {
            held.bindings.push(Binding {
                imported,
                local,
                type_only: entry.is_type,
                line,
            });
        }
    }
    requests.extend(republished.into_iter().map(|group| Request {
        value: group.value,
        kind: if group.only_types {
            Kind::Type
        } else {
            Kind::Reexports
        },
        bindings: group.bindings,
        line: group.line,
    }));

    let mut reasons = Vec::new();
    let (members, loads) = members_and_loads_in(&parsed.program, &lines, &requests);
    requests.extend(loads.dynamic);
    reasons.extend((0..loads.unread_dynamic).map(|_| "an `import()` whose specifier is not a literal".to_owned()));
    requests.extend(loads.required);
    if loads.unread_required > 0 {
        reasons.push(format!("{} `require()` call(s) with a specifier this cannot read", loads.unread_required));
    }
    let depends = crate::depends::depends_in(source, &parsed.program.comments, &lines);
    requests.extend(depends.requests);
    if depends.pathless > 0 {
        reasons.push(format!("{} `/// <depends>` directive(s) that name no `path`", depends.pathless));
    }
    if let Some(first) = parsed.diagnostics.first() {
        let count = parsed.diagnostics.len();
        reasons.push(format!("{count} parse error(s): {}", first.message));
    }

    let clean = !parsed.panicked && parsed.diagnostics.is_empty();
    let size = size_of(source, &parsed.program, source_type.is_typescript(), clean);
    Read {
        requests,
        exports,
        symbols: harvest.symbols,
        harvested: symbols,
        declares: declarations(file, &parsed.program),
        mocks: mocks_in(source, &parsed.program),
        members,
        unknown: (!reasons.is_empty()).then(|| reasons.join("; ")),
        size: Some(size),
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn is_zero(value: &u8) -> bool {
    *value == 0
}

fn import_name(name: &ImportImportName<'_>) -> String {
    match name {
        ImportImportName::Name(name) => name.name.to_string(),
        ImportImportName::NamespaceObject => "*".to_owned(),
        ImportImportName::Default(_) => "default".to_owned(),
    }
}

fn export_name(name: &ExportExportName<'_>) -> Option<String> {
    match name {
        ExportExportName::Name(name) => Some(name.name.to_string()),
        ExportExportName::Default(_) => Some("default".to_owned()),
        ExportExportName::Null => None,
    }
}

fn source_name(name: &ExportImportName<'_>) -> Option<String> {
    match name {
        ExportImportName::Name(name) => Some(name.name.to_string()),
        ExportImportName::All | ExportImportName::AllButDefault => Some("*".to_owned()),
        ExportImportName::Null => None,
    }
}

#[cfg(test)]
#[path = "read_tests.rs"]
mod tests;
