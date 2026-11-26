use super::{counted, Evidence, Operand, Page};

pub(super) fn answer(
    kept: &[Operand],
    headers: &[String],
    notes: &[String],
    files: &[&str],
    text: &Evidence,
    page: Page,
) -> String {
    let reaches: Vec<_> = kept.iter().filter_map(|set| set.reach.as_ref().map(|reach| (set, reach))).collect();
    let heading = if files.is_empty() {
        "No file is in all of them:".into()
    } else {
        let order = if reaches.is_empty() { ":" } else { ", nearest first:" };
        format!("{} in all of them{order}", counted(files.len()))
    };
    let mut lines = vec![heading];
    lines.extend(headers.iter().map(|line| format!("- {line}")));
    let end = page.offset.saturating_add(page.limit).min(files.len());
    if !files.is_empty() {
        let shown = &files[page.offset.min(end)..end];
        let chains: Vec<Vec<_>> = reaches
            .iter()
            .map(|(set, reach)| shown.iter().map(|&file| reach.chain(file, set.files[file], &set.evidence)).collect())
            .collect();
        let chained: Vec<_> = chains
            .iter()
            .enumerate()
            .filter(|(_, column)| column.iter().any(Option::is_some))
            .map(|(at, _)| at)
            .collect();
        let ends: Vec<_> = chains.iter().map(|column| shared_end(column.iter().filter_map(Option::as_deref))).collect();
        if !reaches.is_empty() {
            let said = reaches.iter().map(|(_, reach)| reach.said.as_str()).collect::<Vec<_>>().join(", then ");
            lines.push(format!("each row: imports {said}"));
        }
        for (at, suffix) in ends.iter().enumerate().filter(|(_, suffix)| !suffix.is_empty()) {
            let which = if chained.len() > 1 { format!("{} ", reaches[at].1.said) } else { String::new() };
            lines.push(format!("chains {which}end: {}", suffix.join(" → ")));
        }
        if page.offset >= files.len() {
            let noun = if files.len() == 1 { "row" } else { "rows" };
            lines.push(format!("`--offset` {} is past the last of {} {noun}.", page.offset, files.len()));
        } else if page.offset != 0 {
            lines.push(format!("Rows {}–{end} of {}.", page.offset + 1, files.len()));
        }
        for (row, &file) in shown.iter().enumerate() {
            let mut lead = String::new();
            for (set, _) in &reaches {
                lead.push_str(&format!("{} ", set.files[file]));
            }
            let inline = match chained.as_slice() {
                [at] => chains[*at][row].as_ref().map(|chain| own_steps(chain, ends[*at].len())),
                _ => None,
            };
            lines.push(format!("{lead}{}", inline.as_deref().unwrap_or(file)));
            if chained.len() > 1 {
                for &at in &chained {
                    if let Some(chain) = &chains[at][row] {
                        lines.push(format!("  → {}", own_steps(chain, ends[at].len())));
                    }
                }
            }
            for found in kept
                .iter()
                .filter_map(|set| {
                    if set.reach.as_ref().is_some_and(|reach| reach.named) && set.files[file] != 1 {
                        return None;
                    }
                    set.evidence.get(file)
                })
                .chain(text.get(file))
                .flatten()
            {
                lines.push(format!("  {}: {}", found.0, found.1.trim_start_matches(crate::text_cut::blank)));
            }
        }
    }
    lines.extend(notes.iter().map(|note| format!("note: {note}")));
    if end < files.len() {
        let more = files.len() - end;
        lines.push(format!("{more} more not shown; `--offset` {end} shows the next {}.", more.min(page.limit)));
    }
    lines.join("\n")
}

fn shared_end<'a>(mut chains: impl Iterator<Item = &'a [String]>) -> &'a [String] {
    let Some(first) = chains.next() else { return &[] };
    let mut shared = first.len().saturating_sub(1);
    let mut compared = false;
    for chain in chains {
        compared = true;
        shared = chain
            .iter()
            .rev()
            .zip(first.iter().rev())
            .take(shared.min(chain.len().saturating_sub(1)))
            .take_while(|(a, b)| a == b)
            .count();
    }
    if compared {
        &first[first.len() - shared..]
    } else {
        &[]
    }
}

fn own_steps(chain: &[String], shared: usize) -> String {
    let kept = chain.len().saturating_sub(shared);
    let mut joined = chain[..kept].join(" → ");
    if shared > 0 {
        joined.push_str(" → …");
    }
    joined
}
