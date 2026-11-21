//! How rare a word is in a population, and how much of a row it fills: the
//! one definition of the integer weights a ranking sums, for the addon's
//! rankings and, through napi, for the TypeScript ones.

use napi_derive::napi;

/// How rare a word is in a population, as an integer from 0 to 1000: of
/// `population` rows, `holders` hold the word. A word every row holds scores
/// 1000 / (population + 1), never zero; a word one row holds scores nearly
/// 1000. An integer, so a sort key built from it is exact and a tie is a tie
/// (ADR-0057). Both halves are counted over the same rows.
#[napi]
pub fn rarity(population: f64, holders: f64) -> f64 {
    ((1000.0 * (population - holders + 1.0)) / (population + 1.0)).floor()
}

/// BM25's saturation of a term held `held` times in a row of `length`, in
/// thousandths, against the mean of `rows` rows of `total` in all. With `k1`
/// six fifths and `b` three quarters,
/// `1000 h (k1 + 1) / (h + k1 (1 - b) + k1 b L / A)` is
/// `22000 h A / (10 h A + 3 A + 9 L)`, here with `A` as `total / rows`
/// multiplied through: a term held once in a row of the mean length counts
/// 1000, in an empty one 1692, in one ten times the mean 213. With no length
/// to measure against, every row is of the mean length.
#[napi]
pub fn saturation(held: f64, length: f64, total: f64, rows: f64) -> f64 {
    if total == 0.0 {
        ((22000.0 * held) / (10.0 * held + 12.0)).floor()
    } else {
        ((22000.0 * held * total) / (10.0 * held * total + 3.0 * total + 9.0 * length * rows)).floor()
    }
}
