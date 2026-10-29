//! The lines of a file that use a name the file declares, read off the parse
//! rows the scan wrote: an import never names them, so `importers` asks here
//! for the files it was asked about. The rows hold the uses of what the
//! file's imports bind too, which are no declaration's of the file.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use napi_derive::napi;

use crate::compact::Layer;
use crate::help_usage::kind_of;
use crate::orient_map_read::beside;
use crate::package_graph::{join_parses, At, Crossing};
use crate::package_owners::{owners, NO_OWNER};

/// One line of a file that uses a name the file declares at its top level.
#[napi(object)]
pub struct InFile {
    pub at: String,
    pub line: u32,
    pub by: String,
    pub kind: String,
}

/// The lines of each of `files` that use `name`, a name the file declares.
pub(crate) fn in_file(root: &str, layers: &[Layer], folded: &HashMap<&str, At>, files: &[String], name: &str) -> Vec<InFile> {
    let mut crossings: Vec<Crossing> = files
        .iter()
        .filter_map(|file| folded.get_key_value(file.as_str()))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    crossings.dedup_by(|a, b| a.file == b.file);
    join_parses(layers, &mut crossings);
    let paths = beside(root, crossings.iter().map(|crossing| crossing.file));
    let owners = owners(root, &paths);
    let mut found = Vec::new();
    for crossing in &crossings {
        let Some((layer, row)) = crossing.parse else { continue };
        let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
        // A file that imports the name and declares none of it uses another
        // file's declaration, which the import answers for: an entry may
        // import a name and pass it on. A file that declares it may bind it
        // again, as Rust's `use super::name;` in an inline test module does.
        let declared = parses.symbols.range(row).any(|symbol| text.text(parses.symbol_name.at(symbol)) == name);
        let bound = parses.requests.range(row).any(|request| {
            parses.request_bindings.range(request).any(|binding| text.text(parses.binding_local.at(binding)) == name)
        });
        if bound && !declared { continue; }
        for at in parses.own_uses.range(row) {
            if text.text(parses.own_use_name.at(at)) != name { continue; }
            let (by, kind) = (owners.package_of(crossing.file), kind_of(crossing.file));
            found.push(InFile { at: crossing.file.to_owned(), line: parses.own_use_line.at(at), by: by.to_owned(), kind: kind.to_owned() });
        }
    }
    found
}
