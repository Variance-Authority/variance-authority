//! The walk over every module this checkout has installed.
//!
//! The other tests hold the shapes somebody thought to write. Installed packages
//! hold the shapes nobody did: minified switches that end a case at the `}`, a
//! re-export with no semicolon as the whole module, a parameter list that is
//! only a destructured rest. Each reached a real suite first, the last as a
//! panic that aborted the worker loading it. So every module under the
//! repository's `node_modules` is instrumented in both modes, and the walk must
//! not panic, and must hand back a program for every source that is one.

use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

use oxc_allocator::Allocator;
use oxc_parser::Parser;

use crate::dialect::dialect;
use crate::{instrument, Mode};

/// `.js`, `.jsx`, `.ts`, `.tsx` and their `.c`/`.m` forms, but no declaration file.
fn is_module(name: &str) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else { return false };
    let extension = extension.strip_prefix(['c', 'm']).unwrap_or(extension);
    let extension = extension.strip_suffix('x').unwrap_or(extension);
    let declaration = stem.ends_with(".d") && extension == "ts";
    matches!(extension, "js" | "ts") && !declaration
}

/// Every module under `directory`. A symlink is not followed: the workspace's
/// own packages are linked in, and they are not what this reads.
fn modules(directory: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else { return };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        let path = entry.path();
        if kind.is_dir() {
            modules(&path, out);
        } else if kind.is_file() && entry.file_name().to_str().is_some_and(is_module) {
            out.push(path);
        }
    }
}

fn parses(name: &str, text: &str) -> Result<(), String> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, dialect(name).unwrap_or_default()).parse();
    if parsed.fatal_error && parsed.diagnostics.is_empty() {
        return Err("a fatal error".to_string());
    }
    parsed.diagnostics.first().map_or(Ok(()), |error| Err(error.to_string()))
}

/// What one module does wrong in either mode, if anything.
fn failures(repository: &Path, file: &Path) -> Vec<String> {
    let name = file.strip_prefix(repository).unwrap_or(file).to_string_lossy().replace('\\', "/");
    let bytes = match fs::read(file) {
        Ok(bytes) => bytes,
        Err(error) => return vec![format!("{name}: {error}")],
    };
    let source = String::from_utf8_lossy(&bytes);
    let mut out = Vec::new();
    for mode in [Mode::Presence, Mode::Entries] {
        let code = match catch_unwind(AssertUnwindSafe(|| instrument(&source, &name, &name, mode))) {
            Ok(instrumented) => instrumented.map(|instrumented| instrumented.code),
            Err(panic) => {
                let message = panic
                    .downcast_ref::<&str>()
                    .map(|text| text.to_string())
                    .or_else(|| panic.downcast_ref::<String>().cloned());
                out.push(format!("{name} ({mode:?}): panicked: {}", message.unwrap_or_default()));
                continue;
            }
        };
        let Some(code) = code else { continue };
        // A text comes back only for a source that parsed in this dialect.
        if let Err(error) = parses(&name, &code) {
            out.push(format!("{name} ({mode:?}): {error}"));
        }
    }
    out
}

#[test]
fn every_installed_module_is_instrumented_without_a_panic_and_a_program_stays_a_program() {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..").canonicalize().expect("the repository root");
    let mut files = Vec::new();
    modules(&repository.join("node_modules"), &mut files);
    assert!(files.len() > 1000, "{} modules under node_modules: run `yarn install` first", files.len());

    let workers = thread::available_parallelism().map_or(4, |count| count.get());
    // Each worker takes the next file, so one large bundle holds up one worker
    // rather than a whole share.
    let next = AtomicUsize::new(0);
    let mut found: Vec<String> = thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|_| {
                scope.spawn(|| {
                    let mut out = Vec::new();
                    while let Some(file) = files.get(next.fetch_add(1, Ordering::Relaxed)) {
                        out.extend(failures(&repository, file));
                    }
                    out
                })
            })
            .collect();
        handles.into_iter().flat_map(|handle| handle.join().expect("a worker")).collect()
    });
    found.sort();
    assert!(found.is_empty(), "{}", found.join("\n"));
}
