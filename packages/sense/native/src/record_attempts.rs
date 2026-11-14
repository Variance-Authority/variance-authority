//! The fold of the attempts part beside the index: how each attempt of a
//! retried case ended, as `attempts-record.ts` writes it, with every case named
//! by the id the folded index gives it. A part that does not parse is refused:
//! the fold says what the shards said, or nothing.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::order;
use crate::record_parts::Ran;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Attempts {
    version: u32,
    attempts: Vec<Attempt>,
}

#[derive(Deserialize, Serialize)]
struct Attempt {
    case: String,
    attempt: u64,
    ended: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<serde_json::Number>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame: Option<String>,
}

#[derive(Serialize)]
struct AttemptsOut {
    version: u32,
    attempts: Vec<Attempt>,
}

/// The shards' attempts (`attempts-record.ts`) as the one run they were: each
/// retried case's rows from the shard that ran it. A row a shard carried from
/// its seed, of a case its last-run layer does not name, yields to the shard
/// that ran the case — which retried it no more when it holds no row — and
/// stands when no shard ran it. Two rows left for one attempt are one, the one
/// that sorts first as JSON, as `attempts-record.ts` keeps it. A row of a case
/// the folded index, `cases`, does not hold is refused as `layAttempts` refuses
/// it. The section is written with no row when no case was retried: the shards
/// kept attempts.
pub(crate) fn fold_attempts(
    shards: &[(&str, &[u8], &HashMap<String, String>)],
    cases: Option<&HashSet<String>>,
    ran: &HashMap<String, Ran>,
) -> Result<Vec<u8>, String> {
    let anyone: HashSet<&str> = ran.values().flat_map(|own| own.cases.iter().map(String::as_str)).collect();
    let mut rows: HashMap<(String, u64), (String, Attempt)> = HashMap::new();
    for (name, bytes, renames) in shards {
        let refused = |why: &str| format!("{name}: its attempts section {why}");
        let section: Attempts = serde_json::from_slice(bytes).map_err(|_| refused("is not one this build reads"))?;
        if section.version != 1 {
            return Err(refused("is not version 1"));
        }
        let own = ran.get(*name);
        for row in section.attempts {
            if row.case.is_empty() || row.attempt < 1 {
                return Err(refused("holds a row that names no case and attempt"));
            }
            let case = renames.get(&row.case).unwrap_or(&row.case).clone();
            if !cases.is_some_and(|cases| cases.contains(&case)) {
                return Err(refused(&format!("holds an attempt of `{case}`, a case the combined index does not record")));
            }
            if anyone.contains(case.as_str()) && !own.is_some_and(|own| own.cases.contains(&case)) {
                continue;
            }
            let row = Attempt { case: case.clone(), ..row };
            let text = serde_json::to_string(&row).map_err(|error| error.to_string())?;
            let key = (case, row.attempt);
            if rows.get(&key).is_none_or(|(held, _)| order::code_unit(&text, held).is_lt()) {
                rows.insert(key, (text, row));
            }
        }
    }
    let mut attempts: Vec<Attempt> = rows.into_values().map(|(_, row)| row).collect();
    attempts.sort_by(|left, right| order::code_unit(&left.case, &right.case).then(left.attempt.cmp(&right.attempt)));
    let mut bytes = serde_json::to_vec(&AttemptsOut { version: 1, attempts }).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[cfg(test)]
#[path = "record_attempts_tests.rs"]
mod tests;
