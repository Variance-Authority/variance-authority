//! One module's cacheable facts, extracted without letting its AST cross N-API.

use std::collections::{HashMap, HashSet};

use oxc_allocator::Allocator;
use oxc_ast::ast::{Program, Statement};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_syntax::module_record::{ExportExportName, ExportImportName, ExportLocalName, ImportImportName};

use crate::declarations::declarations;
use crate::declared_role::DeclaredRoles;
use crate::harvest::Harvest;
use crate::help_member_uses::member_uses_in;
use crate::help_own_uses::own_uses_in;
use crate::help_members::member_declarations_in;
use crate::members::members_and_loads_in;
use crate::mocks::mocks_in;
use crate::source_size::size_of;

pub use crate::read_shape::{Binding, Export, Kind, Read, Request};
pub(crate) use crate::read_shape::Lines;

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

pub use variance_sense_instrument::native::dialect;

/// One module's `Parsed` value, from OXC's native module record.
pub fn read_module(file: &str, source: &str, allocator: &Allocator, symbols: bool) -> Read {
    read_module_and_tree(file, source, allocator, symbols).0
}

/// [`read_module`]'s value and the tree it was read from, for a caller that asks
/// the tree what the module record does not hold, so the file is parsed once.
pub(crate) fn read_module_and_tree<'a>(file: &str, source: &'a str, allocator: &'a Allocator, symbols: bool) -> (Read, Program<'a>) {
    let source_type = dialect(file).unwrap_or_else(SourceType::tsx);
    let parsed = Parser::new(allocator, source, source_type).parse();
    let record = &parsed.module_record;
    let lines = Lines::new(source);
    let mut harvest = Harvest::new(&parsed.program, source, &lines, symbols);
    // A module's own top level is its alone; a script's is global, or handed
    // out through `module.exports`, and `export =` hands out what it names,
    // neither of which the record holds.
    let assigned = parsed.program.body.iter().any(|statement| crate::assigned_object::handed_out(statement).is_some());
    if record.has_module_syntax && !assigned {
        for symbol in &mut harvest.symbols {
            symbol.reach = Some("file");
        }
    }
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
        republishes: false,
    }));

    let mut entries: Vec<_> = record
        .local_export_entries
        .iter()
        .chain(record.indirect_export_entries.iter())
        .chain(record.star_export_entries.iter())
        .collect();
    entries.sort_by_key(|entry| (entry.statement_span.start, entry.span.start));

    // A namespace a module imports and exports by its local name, `import * as
    // g from 'm'; export { g }`, is the module passed on as `export * as g from
    // 'm'`, and is recorded as that: the binding is the module record.
    let namespaces: HashMap<&str, &str> = record
        .import_entries
        .iter()
        .filter(|entry| matches!(entry.import_name, ImportImportName::NamespaceObject))
        .map(|entry| (entry.local_name.name.as_str(), entry.module_request.name.as_str()))
        .collect();

    let mut exports = Vec::with_capacity(entries.len());
    let mut republished: Vec<ReexportGroup> = Vec::new();
    let mut groups: HashMap<String, usize> = HashMap::new();
    for entry in entries {
        let line = lines.at(entry.statement_span.start);
        let mut from = entry
            .module_request
            .as_ref()
            .map(|name| name.name.to_string());
        let exported = export_name(&entry.export_name);
        let mut imported = source_name(&entry.import_name);
        // The record's own bound name, which for `export default name` is
        // `name`: `exported` already says `default`, and the identifier is what
        // a reader follows through this file's imports to where it comes from.
        // An anonymous `export default function () {}` binds the declaration
        // the harvest names `default`, so the export is bound like any other.
        let mut local = entry.local_name.name().map(|name| name.to_string()).or_else(|| (from.is_none() && exported.as_deref() == Some("default")).then(|| "default".to_owned()));
        if let ExportLocalName::Name(name) = &entry.local_name {
            if let Some(module) = namespaces.get(name.name.as_str()) {
                (from, imported, local) = (Some((*module).to_owned()), Some("*".to_owned()), None);
            }
        }

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
            assigned: false,
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
    // A named function or class the module hands out whole is what an importer's
    // default gets, as `export default function name` is.
    if let Some((statement, (id, _, _))) = crate::assigned_object::handed_out_named(&parsed.program.body) {
        let at = oxc_span::GetSpan::span(statement);
        let local = id.name.to_string();
        let tags = roles.of(at.start, Some(&local));
        exports.push(Export {
            exported: Some("default".to_owned()),
            local: Some(local),
            from: None,
            imported: None,
            type_only: false,
            line: lines.at(at.start),
            signature: Some(harvest.span(at)),
            doc: harvest.doc(at.start),
            assigned: false,
            tags,
        });
    }
    // An object the module hands out whole exports each key, when it spells them all.
    for statement in &parsed.program.body {
        let Some(object) = crate::assigned_object::assigned(statement).filter(|it| crate::assigned_object::spelled(it)) else { continue };
        let at = oxc_span::GetSpan::span(statement);
        for key in crate::assigned_object::keys(object) {
            let local = key.local.map(|it| it.name.to_string());
            let tags = roles.of(at.start, local.as_deref());
            // A key is declared where it is written, and documented there or on the statement.
            let doc = harvest.doc(key.span.start).or_else(|| harvest.doc(at.start));
            exports.push(Export {
                exported: Some(key.name),
                local,
                from: None,
                imported: None,
                type_only: false,
                line: lines.at(key.span.start),
                signature: Some(harvest.span(key.span)),
                doc,
                tags,
                assigned: true,
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
        republishes: true,
    }));

    let mut reasons = Vec::new();
    // One scope tree serves every reader that resolves a name by scope.
    let built = SemanticBuilder::new().build(&parsed.program);
    let scoping = built.semantic.scoping();
    let (members, binding_members, loads, taken) = members_and_loads_in(&parsed.program, scoping, &lines, &requests);
    // A binding destructured off a module it holds is that module's value under
    // a local name, as an import binds one, and declares nothing of its own,
    // unless the file exports it: the export publishes the binding, and the
    // binding is what says what it is, as `export const s = lib.shout` does.
    let published: HashSet<&str> = exports.iter().filter(|it| it.from.is_none()).filter_map(|it| it.local.as_deref().or(it.exported.as_deref())).collect();
    harvest.symbols.retain(|symbol| published.contains(symbol.name.as_str()) || !taken.contains(&(symbol.name.clone(), symbol.line)));
    requests.extend(loads.dynamic);
    reasons.extend((0..loads.unread_dynamic).map(|_| "an `import()` whose specifier is not a literal".to_owned()));
    requests.extend(loads.required);
    if loads.unread_required > 0 {
        reasons.push(format!("{} `require()` call(s) with a specifier this cannot read", loads.unread_required));
    }
    requests.extend(loads.typed);
    let unread = loads.unread_typed + parsed.program.body.iter().filter(|statement| unread_statement(statement)).count();
    if unread > 0 {
        reasons.push(format!("{unread} import(s) or export(s) with a specifier this cannot read"));
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

    let clean = !parsed.fatal_error && parsed.diagnostics.is_empty();
    let size = size_of(source, &parsed.program, source_type.is_typescript(), clean);
    let member_declarations = member_declarations_in(&parsed.program, &lines, &harvest);
    let read = Read {
        requests,
        exports,
        symbols: harvest.symbols,
        nested: harvest.nested,
        test_blocks: harvest.test_blocks,
        harvested: symbols,
        declares: declarations(file, &parsed.program),
        mocks: mocks_in(source, &parsed.program, scoping),
        members,
        binding_members,
        member_declarations,
        member_uses: member_uses_in(&parsed.program, &lines),
        own_uses: own_uses_in(&parsed.program, scoping, &lines),
        unknown: (!reasons.is_empty()).then(|| reasons.join("; ")),
        size: Some(size),
        doc: harvest.module_doc,
    };
    drop(built);
    (read, parsed.program)
}

/// Whether a statement names its module by a specifier no text holds, which
/// the module record leaves out, so nothing else in a read says it is there.
fn unread_statement(statement: &Statement) -> bool {
    let source = match statement {
        Statement::ImportDeclaration(it) => &it.source,
        Statement::ExportFromDeclaration(it) => &it.source,
        Statement::ExportAllDeclaration(it) => &it.source,
        _ => return false,
    };
    source.value.as_str().is_none()
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

#[cfg(test)]
#[path = "read_objects_tests.rs"]
mod objects_tests;

#[cfg(test)]
#[path = "read_binding_members_tests.rs"]
mod binding_members_tests;

#[cfg(test)]
#[path = "read_passed_tests.rs"]
mod passed_tests;
