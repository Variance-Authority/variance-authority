//! How long each statement of a cut case took, as `case-times.ts` lays it.
//!
//! A case's row is varint pairs, one a line its body cut at in the order it
//! first reached them: the line as its zigzagged distance from the line before
//! it, the first from 0, then its whole microseconds. No bytes is a case whose
//! statements were not timed.

use crate::case_shard::put;
use crate::case_shard::Varints;

/// One case's row from its lines and times.
pub(crate) fn encode(times: &[(u32, u64)]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut previous = 0_i64;
    for &(line, time) in times {
        let step = i64::from(line) - previous;
        put(&mut out, if step < 0 { (-step * 2 - 1) as u64 } else { (step * 2) as u64 });
        put(&mut out, time);
        previous = i64::from(line);
    }
    out
}

/// One case's lines and times off its row.
pub(crate) fn decode(bytes: &[u8]) -> Result<Vec<(u32, u64)>, String> {
    let mut read = Varints::new(bytes);
    let mut times = Vec::new();
    let mut line = 0_i64;
    while read.left() > 0 {
        let step = read.take()? as i64;
        line += if step % 2 == 1 { -(step + 1) / 2 } else { step / 2 };
        let at = u32::try_from(line).map_err(|_| "case times name a line before the file".to_owned())?;
        times.push((at, read.take()?));
    }
    Ok(times)
}

/// The row of one case across two frames: the one that ran longer in all, and
/// of two that ran as long the lower, line by line, so no order of frames
/// changes it. An untimed frame yields to a timed one.
pub(crate) fn across<'a>(first: &'a [u8], second: &'a [u8]) -> Result<&'a [u8], String> {
    if first.is_empty() || second.is_empty() {
        return Ok(if first.is_empty() { second } else { first });
    }
    let (left, right) = (decode(first)?, decode(second)?);
    let total = |times: &[(u32, u64)]| times.iter().map(|(_, time)| time).sum::<u64>();
    let second_wins = (total(&right), std::cmp::Reverse(&right)) > (total(&left), std::cmp::Reverse(&left));
    Ok(if second_wins { second } else { first })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_case_that_ran_twice_keeps_the_run_that_took_longer_in_all_whichever_comes_first() {
        let (quick, long) = (encode(&[(4, 30), (9, 10)]), encode(&[(9, 80)]));
        assert_eq!(across(&quick, &long).unwrap(), &long[..]);
        assert_eq!(across(&long, &quick).unwrap(), &long[..]);
    }

    #[test]
    fn of_two_runs_as_long_it_keeps_the_lower_line_by_line() {
        let (long, level) = (encode(&[(9, 80)]), encode(&[(2, 80)]));
        assert_eq!(across(&long, &level).unwrap(), &level[..]);
        assert_eq!(across(&level, &long).unwrap(), &level[..]);
    }

    #[test]
    fn an_untimed_run_yields_to_the_timed_one() {
        let quick = encode(&[(4, 30), (9, 10)]);
        assert_eq!(across(&quick, &[]).unwrap(), &quick[..]);
        assert_eq!(across(&[], &quick).unwrap(), &quick[..]);
        assert!(across(&[], &[]).unwrap().is_empty());
        assert_eq!(decode(&quick).unwrap(), vec![(4, 30), (9, 10)]);
    }
}
