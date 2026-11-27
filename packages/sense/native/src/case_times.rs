//! How long each statement of a cut case took, as `case-times.ts` lays it.
//!
//! A case's row is varint pairs, one a line its body cut at in the order it
//! first reached them: the line as its zigzagged distance from the line before
//! it, the first from 0, then its whole microseconds. No bytes is a case whose
//! statements were not timed.
//!
//! A row that read what surrounded its statements starts with a 0, and each
//! pair is followed by a base-3 digit per figure, then the value of each that
//! moved, as `case-times.ts` says. Nothing here reads them; they are carried.

use crate::case_shard::put;
use crate::case_shard::Varints;

/// What surrounded one statement as its row keeps them, each absent where it
/// was not read: the load in hundredths, the RSS and free memory in MiB, and the
/// nodes it added. `FIGURES` in `case-times.ts`.
pub(crate) type Around = [Option<u64>; 4];

/// The figure that counts what a statement added, the others being levels.
const ADDED: usize = 3;

fn zigzag(step: i64) -> u64 {
    if step < 0 { (-step * 2 - 1) as u64 } else { (step * 2) as u64 }
}

fn unzigzag(word: u64) -> i64 {
    let word = word as i64;
    if word % 2 == 1 { -(word + 1) / 2 } else { word / 2 }
}

/// One case's row from its lines and times, none of them beside a figure.
#[cfg(test)]
pub(crate) fn encode(times: &[(u32, u64)]) -> Vec<u8> {
    encode_around(times, &[])
}

/// One case's row from its lines and times, each beside what surrounded it,
/// by position; a statement past `around`'s end read nothing.
pub(crate) fn encode_around(times: &[(u32, u64)], around: &[Around]) -> Vec<u8> {
    let read = around.iter().any(|figures| figures.iter().any(Option::is_some));
    let mut out = if read { vec![0] } else { Vec::new() };
    let mut last = [0_i64; ADDED];
    let mut previous = 0_i64;
    for (at, &(line, time)) in times.iter().enumerate() {
        put(&mut out, zigzag(i64::from(line) - previous));
        put(&mut out, time);
        previous = i64::from(line);
        if !read {
            continue;
        }
        let (mut digits, mut moved) = (0_u64, Vec::new());
        for (figure, value) in around.get(at).copied().unwrap_or_default().into_iter().enumerate() {
            let Some(value) = value else { continue };
            let step = if figure == ADDED {
                value
            } else {
                let step = zigzag(value as i64 - last[figure]);
                last[figure] = value as i64;
                step
            };
            digits += if step == 0 { 1 } else { 2 } * 3_u64.pow(figure as u32);
            if step != 0 {
                moved.push(step);
            }
        }
        put(&mut out, digits);
        for step in moved {
            put(&mut out, step);
        }
    }
    out
}

/// One case's lines and times off its row, what surrounded them read past.
pub(crate) fn decode(bytes: &[u8]) -> Result<Vec<(u32, u64)>, String> {
    let read = bytes.first() == Some(&0);
    let mut words = Varints::new(if read { &bytes[1..] } else { bytes });
    let mut times = Vec::new();
    let mut line = 0_i64;
    while words.left() > 0 {
        line += unzigzag(words.take()?);
        let at = u32::try_from(line).map_err(|_| "case times name a line before the file".to_owned())?;
        times.push((at, words.take()?));
        if !read {
            continue;
        }
        let mut digits = words.take()?;
        if digits >= 3_u64.pow(4) {
            return Err("case times name a figure past the four a row keeps".to_owned());
        }
        for _ in 0..4 {
            if digits % 3 == 2 {
                words.take()?;
            }
            digits /= 3;
        }
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

    #[test]
    fn a_row_that_read_its_surroundings_is_weighed_by_its_times_alone() {
        let read = encode_around(&[(4, 30), (9, 80)], &[[Some(1625), Some(300), None, Some(31)], [Some(1625), Some(290), None, None]]);
        assert_eq!(read[0], 0);
        assert_eq!(decode(&read).unwrap(), vec![(4, 30), (9, 80)]);
        let quick = encode(&[(4, 30)]);
        assert_eq!(across(&quick, &read).unwrap(), &read[..]);
        assert_eq!(across(&read, &quick).unwrap(), &read[..]);
    }
}
