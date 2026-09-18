//! The parse half of the existing source-index generation format.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::order;
use crate::read::Read;

const NONE: u32 = u32::MAX;
const ALIGNMENT: usize = 8;

struct Column {
    name: &'static str,
    width: u8,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
struct Section {
    name: &'static str,
    offset: usize,
    length: usize,
    width: u8,
}

#[derive(Serialize)]
struct Header {
    format: &'static str,
    version: u8,
    sections: Vec<Section>,
}

/// A complete generation containing parses and empty values for every other
/// source-index layer. A following generation may carry records and tree shape;
/// the existing immutable-log reader already folds those layers together.
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

    let mut values = HashSet::new();
    for (key, index) in &rows {
        let (digest, way) = parts(key);
        values.insert(digest.to_owned());
        values.insert(way.to_owned());
        let read = &reads[*index].0;
        for request in &read.requests {
            values.insert(request.value.clone());
            values.insert(request.kind.as_str().to_owned());
            for binding in &request.bindings {
                values.insert(binding.imported.clone());
                values.insert(binding.local.clone());
            }
        }
        for export in &read.exports {
            for value in [
                export.exported.as_ref(),
                export.local.as_ref(),
                export.from.as_ref(),
                export.imported.as_ref(),
            ]
            .into_iter()
            .flatten()
            {
                values.insert(value.clone());
            }
        }
        values.extend(read.declares.iter().cloned());
        if let Some(unknown) = &read.unknown {
            values.insert(unknown.clone());
        }
    }
    let mut strings: Vec<String> = values.into_iter().collect();
    strings.sort_unstable_by(|left, right| order::code_unit(left, right));
    let ids: HashMap<&str, u32> = strings
        .iter()
        .enumerate()
        .map(|(index, value)| (value.as_str(), index as u32))
        .collect();
    let id = |value: &str| ids[value];

    let mut string_blob = Vec::new();
    let mut string_off = vec![0];
    for value in &strings {
        string_blob.extend_from_slice(value.as_bytes());
        string_off.push(string_blob.len() as u32);
    }

    let mut parse_digest = Vec::with_capacity(rows.len());
    let mut parse_way = Vec::with_capacity(rows.len());
    let mut parse_requests = Vec::with_capacity(rows.len() + 1);
    let mut parse_exports = Vec::with_capacity(rows.len() + 1);
    let mut parse_exports_present = Vec::with_capacity(rows.len());
    let mut parse_declares = Vec::with_capacity(rows.len() + 1);
    let mut parse_declares_present = Vec::with_capacity(rows.len());
    let mut parse_unknown = Vec::with_capacity(rows.len());
    let mut request_value = Vec::new();
    let mut request_kind = Vec::new();
    let mut request_line = Vec::new();
    let mut request_bindings = vec![0];
    let mut binding_imported = Vec::new();
    let mut binding_local = Vec::new();
    let mut binding_type = Vec::new();
    let mut binding_line = Vec::new();
    let mut export_exported = Vec::new();
    let mut export_local = Vec::new();
    let mut export_from = Vec::new();
    let mut export_imported = Vec::new();
    let mut export_type = Vec::new();
    let mut export_line = Vec::new();
    let mut declare_name = Vec::new();

    for (key, index) in &rows {
        let (digest, held_way) = parts(key);
        let read = &reads[*index].0;
        parse_digest.push(id(digest));
        parse_way.push(id(held_way));
        parse_requests.push(request_value.len() as u32);
        for request in &read.requests {
            request_value.push(id(&request.value));
            request_kind.push(id(request.kind.as_str()));
            request_line.push(request.line);
            for binding in &request.bindings {
                binding_imported.push(id(&binding.imported));
                binding_local.push(id(&binding.local));
                binding_type.push(u8::from(binding.type_only));
                binding_line.push(binding.line);
            }
            request_bindings.push(binding_imported.len() as u32);
        }
        parse_exports.push(export_exported.len() as u32);
        parse_exports_present.push(u8::from(!read.exports.is_empty()));
        for export in &read.exports {
            export_exported.push(optional(export.exported.as_deref(), &id));
            export_local.push(optional(export.local.as_deref(), &id));
            export_from.push(optional(export.from.as_deref(), &id));
            export_imported.push(optional(export.imported.as_deref(), &id));
            export_type.push(u8::from(export.type_only));
            export_line.push(export.line);
        }
        parse_declares.push(declare_name.len() as u32);
        parse_declares_present.push(u8::from(!read.declares.is_empty()));
        declare_name.extend(read.declares.iter().map(|name| id(name)));
        parse_unknown.push(optional(read.unknown.as_deref(), &id));
    }
    parse_requests.push(request_value.len() as u32);
    parse_exports.push(export_exported.len() as u32);
    parse_declares.push(declare_name.len() as u32);

    encode(vec![
        u8s("strings.blob", string_blob),
        u32s("strings.off", string_off),
        u32s("index.config", vec![NONE]),
        u32s("directories.path", vec![]),
        u32s("directories.digest", vec![]),
        u32s("directories.deleted", vec![]),
        u32s("parses.key", parse_digest),
        u32s("parses.key-way", parse_way),
        u32s("parses.deleted", vec![]),
        u32s("parses.deleted-way", vec![]),
        u32s("parses.requests", parse_requests),
        u32s("parses.exports", parse_exports),
        u8s("parses.exports-present", parse_exports_present),
        u32s("parses.declares", parse_declares),
        u8s("parses.declares-present", parse_declares_present),
        u32s("parses.unknown", parse_unknown),
        u32s("requests.value", request_value),
        u32s("requests.kind", request_kind),
        u32s("requests.line", request_line),
        u32s("requests.bindings", request_bindings),
        u32s("bindings.imported", binding_imported),
        u32s("bindings.local", binding_local),
        u8s("bindings.type", binding_type),
        u32s("bindings.line", binding_line),
        u32s("exports.exported", export_exported),
        u32s("exports.local", export_local),
        u32s("exports.from", export_from),
        u32s("exports.imported", export_imported),
        u8s("exports.type", export_type),
        u32s("exports.line", export_line),
        u32s("declares.name", declare_name),
        u32s("records.file", vec![]),
        u32s("records.deleted", vec![]),
        u32s("records.digest", vec![]),
        u32s("records.edges", vec![0]),
        u8s("records.edges-present", vec![]),
        u32s("records.declares", vec![0]),
        u8s("records.declares-present", vec![]),
        u32s("records.unresolved", vec![0]),
        u8s("records.unresolved-present", vec![]),
        u32s("records.unknown", vec![]),
        u32s("records.witnesses", vec![0]),
        u32s("witnesses.directory", vec![]),
        u32s("edges.to", vec![]),
        u32s("edges.kind", vec![]),
        u32s("record-declares.name", vec![]),
        u32s("unresolved.value", vec![]),
    ])
}

fn way(file: &str) -> String {
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

fn parts(key: &str) -> (&str, &str) {
    key.split_once('\0').unwrap_or((key, ""))
}

fn optional(value: Option<&str>, id: &impl Fn(&str) -> u32) -> u32 {
    value.map_or(NONE, id)
}

fn u8s(name: &'static str, bytes: Vec<u8>) -> Column {
    Column {
        name,
        width: 1,
        bytes,
    }
}

fn u32s(name: &'static str, values: Vec<u32>) -> Column {
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    Column {
        name,
        width: 4,
        bytes,
    }
}

fn aligned(value: usize) -> usize {
    (value + ALIGNMENT - 1) & !(ALIGNMENT - 1)
}

fn encode(columns: Vec<Column>) -> Vec<u8> {
    let mut offset = 0;
    let sections = columns
        .iter()
        .map(|column| {
            let section = Section {
                name: column.name,
                offset,
                length: column.bytes.len(),
                width: column.width,
            };
            offset = aligned(offset + column.bytes.len());
            section
        })
        .collect();
    let header = serde_json::to_vec(&Header {
        format: "variance-authority-source-index",
        version: 5,
        sections,
    })
    .unwrap_or_default();
    let header_length = aligned(4 + header.len()) - 4;
    let mut out = Vec::with_capacity(4 + header_length + offset);
    out.extend_from_slice(&(header_length as u32).to_le_bytes());
    out.extend_from_slice(&header);
    out.resize(4 + header_length, 0);
    for column in columns {
        out.extend_from_slice(&column.bytes);
        out.resize(aligned(out.len()), 0);
    }
    out
}
