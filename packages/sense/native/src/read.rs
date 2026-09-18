//! One module's cacheable facts, extracted without letting its AST cross N-API.

use std::collections::HashMap;
use std::sync::OnceLock;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use oxc_syntax::module_record::{
    ExportExportName, ExportImportName, ExportLocalName, ImportImportName,
};
use regex::Regex;
use serde::Serialize;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Imports = 0,
    Reexports,
    Dynamic,
    Type,
}

impl Kind {
    pub const ALL: [Kind; 4] = [Kind::Imports, Kind::Reexports, Kind::Dynamic, Kind::Type];
    pub fn code(self) -> u8 {
        self as u8
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Imports => "imports",
            Self::Reexports => "reexports",
            Self::Dynamic => "dynamic",
            Self::Type => "type",
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
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Read {
    pub requests: Vec<Request>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) exports: Vec<Export>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) declares: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown: Option<String>,
}

struct Lines(Vec<usize>);

impl Lines {
    fn new(source: &str) -> Self {
        let mut starts = vec![0];
        starts.extend(source.match_indices('\n').map(|(at, _)| at + 1));
        Self(starts)
    }

    fn at(&self, offset: u32) -> u32 {
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

/// The same `Parsed` value `read.ts` produces, from OXC's native module record.
pub fn read_module(file: &str, source: &str, allocator: &Allocator) -> Read {
    let source_type = SourceType::from_path(file).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(allocator, source, source_type).parse();
    let record = &parsed.module_record;
    let lines = Lines::new(source);
    let mut requests = Vec::new();
    let mut imports: Vec<ImportGroup> = Vec::new();

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
    requests.extend(imports.into_iter().map(|group| {
        let only_types = !group.bindings.is_empty() && group.bindings.iter().all(|b| b.type_only);
        Request {
            value: group.value,
            kind: if only_types {
                Kind::Type
            } else {
                Kind::Imports
            },
            bindings: group.bindings,
            line: lines.at(group.at),
        }
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
        let local = local_name(&entry.local_name);

        exports.push(Export {
            exported: exported.clone(),
            local,
            from: from.clone(),
            imported: imported.clone(),
            type_only: entry.is_type,
            line,
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
        held.only_types &= entry.is_type;
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
    for entry in &record.dynamic_imports {
        let text = &source[entry.module_request.start as usize..entry.module_request.end as usize];
        match quoted(text) {
            Some(value) => requests.push(Request {
                value,
                kind: Kind::Dynamic,
                bindings: Vec::new(),
                line: lines.at(entry.span.start),
            }),
            None => reasons.push("an `import()` whose specifier is not a literal".to_owned()),
        }
    }

    let required = read_requires(source, &lines);
    requests.extend(required.requests);
    if let Some(reason) = required.unknown {
        reasons.push(reason);
    }
    if !parsed.diagnostics.is_empty() {
        let first = parsed
            .diagnostics
            .first()
            .map(|e| e.message.to_string())
            .unwrap_or_default();
        reasons.push(format!(
            "{} parse error(s): {first}",
            parsed.diagnostics.len()
        ));
    }

    Read {
        requests,
        exports,
        declares: declarations(file, source),
        unknown: (!reasons.is_empty()).then(|| reasons.join("; ")),
    }
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

fn local_name(name: &ExportLocalName<'_>) -> Option<String> {
    match name {
        ExportLocalName::Name(name) => Some(name.name.to_string()),
        ExportLocalName::Default(_) => Some("default".to_owned()),
        ExportLocalName::Null => None,
    }
}

fn quoted(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let first = *trimmed.as_bytes().first()?;
    if trimmed.len() < 2
        || (first != b'\'' && first != b'"')
        || *trimmed.as_bytes().last()? != first
    {
        return None;
    }
    let value = &trimmed[1..trimmed.len() - 1];
    (!value.contains("${")).then(|| value.to_owned())
}

fn read_requires(source: &str, lines: &Lines) -> Read {
    let mut calls = 0usize;
    let mut requests = Vec::new();
    for (at, _) in source.match_indices("require") {
        if at > 0 && is_word(source.as_bytes()[at - 1]) {
            continue;
        }
        let rest = &source[at + "require".len()..];
        let Some(open) = rest.find(|c: char| !c.is_whitespace()) else {
            continue;
        };
        if rest.as_bytes()[open] != b'(' {
            continue;
        }
        calls += 1;
        let inner = rest[open + 1..].trim_start();
        let Some(quote) = inner.as_bytes().first().copied() else {
            continue;
        };
        if quote != b'\'' && quote != b'"' {
            continue;
        }
        let Some(shut) = inner[1..].find(quote as char) else {
            continue;
        };
        if inner[shut + 2..].trim_start().as_bytes().first() != Some(&b')') {
            continue;
        }
        requests.push(Request {
            value: inner[1..shut + 1].to_owned(),
            kind: Kind::Imports,
            bindings: Vec::new(),
            line: lines.at(at as u32),
        });
    }
    let unread = calls - requests.len();
    Read {
        requests,
        unknown: (unread > 0)
            .then(|| format!("{unread} `require()` call(s) with a specifier this cannot read")),
        ..Read::default()
    }
}

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn declarations(file: &str, source: &str) -> Vec<String> {
    if [".test.", ".spec.", ".stories.", ".d.ts"]
        .iter()
        .any(|skip| file.contains(skip))
    {
        return Vec::new();
    }
    static PATTERNS: OnceLock<[Regex; 3]> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        [
            Regex::new(r"^\s*(?:export\s+)?(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)")
                .unwrap(),
            Regex::new(r"^\s*(?:export\s+)?(?:const|let)\s+([A-Z][A-Za-z0-9_]*)\s*[:=]").unwrap(),
            Regex::new(r"^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Z][A-Za-z0-9_]*)").unwrap(),
        ]
    });
    let mut found = Vec::new();
    for line in source.lines() {
        for pattern in patterns {
            if let Some(name) = pattern.captures(line).and_then(|capture| capture.get(1)) {
                found.push(name.as_str().to_owned());
                break;
            }
        }
    }
    found.sort();
    found.dedup();
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_kinds_the_way_the_oracle_does() {
        assert_eq!(
            Kind::ALL.map(Kind::as_str),
            ["imports", "reexports", "dynamic", "type"]
        );
    }

    #[test]
    fn a_code_indexes_the_name() {
        for (code, kind) in Kind::ALL.iter().enumerate() {
            assert_eq!(kind.code() as usize, code);
        }
    }
}
