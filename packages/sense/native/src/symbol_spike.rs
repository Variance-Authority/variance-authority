//! Development probe for #1766's private-declaration case. The benchmark
//! compares its entire output with the CLI before it times either process.
//! This deliberately does not implement exports, aliases, members or the
//! dependency lexicon, and is absent from the released addon.

// compass: variance-authority.report.agent-surface

use std::path::Path;
use std::time::Instant;

use sha2::{Digest, Sha256};

use crate::help_declared::DeclaredName;
use crate::help_publish::{declared_of, open_index_checked};
use crate::help_store::symbol_spike_generation;
use crate::journeys::hex;

fn timed<T>(stage: &str, read: impl FnOnce() -> T) -> T {
    let start = Instant::now();
    let result = read();
    if std::env::var_os("VARIANCE_AUTHORITY_SPIKE_STAGES").is_some() {
        eprintln!("{stage}: {:.3} ms", start.elapsed().as_secs_f64() * 1000.0);
    }
    result
}

/// A declaration-only answer. Equality with the production CLI is the caller's gate.
pub fn answer(root: &str, index: &str, help: &str, name: &str) -> Result<String, String> {
    let (generated, digest) = timed("help-store", || {
        let bytes = std::fs::read(help).map_err(|error| error.to_string())?;
        let (generated, digest) = symbol_spike_generation(&bytes, Path::new(root))?;
        Ok::<_, String>((generated.to_owned(), digest.to_owned()))
    })?;
    let opened = timed("source-index", || {
        open_index_checked(index.to_owned(), |chain| {
            let chain = chain.ok_or("no source index is published")?;
            if chain.dropped != 0 {
                return Err("the source index is incomplete".into());
            }
            if hex(&Sha256::digest(chain.published())) != digest {
                return Err("the help store describes a different source-index generation".into());
            }
            Ok(())
        })
    }).map_err(|error| error.to_string())?;
    let mut read = timed("declarations", || declared_of(root.to_owned(), &opened, name.to_owned(), false, None))
        .map_err(|error| error.to_string())?
        .ok_or("no source index is published")?;
    if !read.unread.is_empty() || read.names.is_empty() {
        return Err("this probe needs a name with private declarations and no unread declarations".into());
    }
    if read.names.iter().any(|held| held.holder_line.is_some() || held.on.is_some()) {
        return Err("this probe does not render nested or member declarations".into());
    }
    read.names.sort_by_key(|held| match held.file_kind.as_str() { "source" => 0, "test" => 1, _ => 2 });
    timed("render", || {
        if read.names.len() > 5 {
            return Err("this probe does not render truncated declaration lists".into());
        }
        let blocks: Vec<_> = read.names.iter().map(declaration).collect();
        Ok(format!("{}\nSnapshot {generated}, not compared with the checkout: run `variance index` if files changed since.", blocks.join("\n\n")))
    })
}

fn declaration(held: &DeclaredName) -> String {
    let mut rows = vec![
        format!("{} [{}]", held.name, held.kind),
        format!("declared, not exported, at {}:{}{}", held.at, held.line,
            if held.by.is_empty() { String::new() } else { format!(" by {}", held.by) }),
    ];
    rows.extend(held.signature.iter().chain(held.doc.iter()).cloned());
    rows.push(match held.reach.as_deref() {
        Some("file") => format!("Nothing outside {} can import it: no export of that file names it.", held.at),
        Some("module") => "Only the module it is declared in, and the modules inside that one, can name it: it is not `pub`.".into(),
        Some("underscore" | "all") => format!("Another module can still import it by name: {} keeps it out of `from … import *` only.",
            if held.reach.as_deref() == Some("all") { "`__all__`" } else { "a leading underscore" }),
        _ => "Who can reach it is not recorded: its reader cannot tell how this file hands it out.".into(),
    });
    rows.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_private_declaration_keeps_its_signature_doc_and_unicode() {
        let held = DeclaredName {
            name: "Ångström".into(), kind: "const".into(), at: "src/日本語.ts".into(),
            by: "@app/ui".into(), line: 42, file_kind: "source".into(),
            signature: Some("const Ångström".into()), doc: Some("A measurement.".into()),
            reach: Some("file".into()), held: None, named: None, near: None, doc_length: None,
            holder: None, holder_line: None, on: None,
        };
        assert_eq!(declaration(&held), "Ångström [const]\ndeclared, not exported, at src/日本語.ts:42 by @app/ui\nconst Ångström\nA measurement.\nNothing outside src/日本語.ts can import it: no export of that file names it.");
    }
}
