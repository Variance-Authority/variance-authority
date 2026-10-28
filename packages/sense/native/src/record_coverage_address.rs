//! Which addresses name one region in two cuts of a module.
//!
//! A region's address is its name and its path, and each step of either that
//! ends in `#<digits>` took a seat at a counter: its place among the siblings
//! that counter numbered, in source order. An address names one region in both
//! cuts only where each cut holds it as many times and every counter it passes
//! through handed out the same seats in each. An edit that changes a counter's
//! population renumbers what it counts and everything nested under it, and
//! nothing else, so the rest of the module still pairs by address.

use rustc_hash::{FxHashMap, FxHashSet};

/// Whether an address's number means one region in both cuts: each holds it as
/// many times, and every counter it passes through handed out the same seats
/// in each, so no edit renumbered it (`addressedAlike` in `region-landing.ts`).
/// A counter whose population changed renumbers what it counts and everything
/// nested under it, and nothing else.
pub(crate) fn addressed_alike(before: impl Iterator<Item = (String, String)>, after: impl Iterator<Item = (String, String)>) -> impl Fn(&str, &str) -> bool {
    let standing = addressed(before, after);
    move |name, path| standing(name, path) == Standing::Alike
}

/// What the cut `before` says of an address of the cut `after`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Standing {
    /// The address names one region in both cuts.
    Alike,
    /// `before` holds no region at the address, and every counter it passes
    /// through that `before` seated, `before` seated as `after` did: `before`
    /// was cut without it, and says nothing about it.
    Lacked,
    /// `before` holds the address another number of times, or seated a counter
    /// it passes through elsewhere: the number names another region in each.
    Disputed,
}

/// What `before` says of each address of `after`: [`Standing`].
pub(crate) fn addressed(before: impl Iterator<Item = (String, String)>, after: impl Iterator<Item = (String, String)>) -> impl Fn(&str, &str) -> Standing {
    let counts = |blocks: Vec<(String, String)>| {
        let mut counts: FxHashMap<(String, String), u32> = FxHashMap::default();
        for address in &blocks {
            *counts.entry(address.clone()).or_default() += 1;
        }
        (sites(blocks.into_iter()), counts)
    };
    let ((was, held), (now, fresh)) = (counts(before.collect()), counts(after.collect()));
    move |name, path| {
        let address = (name.to_owned(), path.to_owned());
        let seats = seats_of(name, path);
        if held.get(&address) == fresh.get(&address) && seats.iter().all(|(site, _)| matches!((was.get(site), now.get(site)), (Some(left), Some(right)) if left == right)) {
            Standing::Alike
        } else if !held.contains_key(&address) && seats.iter().all(|(site, _)| !matches!((was.get(site), now.get(site)), (Some(left), right) if Some(left) != right)) {
            Standing::Lacked
        } else {
            Standing::Disputed
        }
    }
}

/// The seats each site of a cut holds.
fn sites(blocks: impl Iterator<Item = (String, String)>) -> FxHashMap<String, FxHashSet<u64>> {
    let mut sites: FxHashMap<String, FxHashSet<u64>> = FxHashMap::default();
    for (name, path) in blocks {
        for (site, seat) in seats_of(&name, &path) {
            sites.entry(site).or_default().insert(seat);
        }
    }
    sites
}

/// Every counter an address passes through, with the seat it took there, as
/// the bits of the number the seat's digits read as.
fn seats_of(name: &str, path: &str) -> Vec<(String, u64)> {
    let mut found = Vec::new();
    let mut steps = |path: &str, from: String| -> String {
        let mut at = from;
        for step in path.split('/').filter(|_| !path.is_empty()) {
            if let Some((prefix, seat)) = seat(step) {
                found.push((format!("{at}/{prefix}"), seat));
            }
            at.push('/');
            at.push_str(step);
        }
        at
    };
    let named = steps(name, String::new());
    steps(path, format!("{named}\0"));
    found
}

/// A step's counter and seat: the digits after its last `#`, which run to its
/// end, over a prefix on one line.
fn seat(step: &str) -> Option<(&str, u64)> {
    let (prefix, digits) = step.rsplit_once('#')?;
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) || prefix.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    digits.parse::<f64>().ok().map(|seat| (prefix, seat.to_bits()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_seat_is_the_digits_after_the_last_hash_of_a_step() {
        assert_eq!(seat("if#12"), Some(("if", 12_f64.to_bits())));
        assert_eq!(seat("a#b#3"), Some(("a#b", 3_f64.to_bits())));
        assert_eq!(seat("if#"), None);
        assert_eq!(seat("if#1x"), None);
        assert_eq!(seat("if#2#x"), None);
        assert_eq!(seat("line\nbreak#1"), None);
        assert_eq!(seat("then"), None);
    }

    #[test]
    fn seats_are_sited_by_the_name_then_the_path_they_pass_through() {
        assert_eq!(seats_of("decide/map.arg#1", "if#0/then"), vec![("/decide/map.arg".to_owned(), 1_f64.to_bits()), ("/decide/map.arg#1\0/if".to_owned(), 0_f64.to_bits())]);
        assert_eq!(seats_of("", "anon#2"), vec![("\0/anon".to_owned(), 2_f64.to_bits())]);
    }

    #[test]
    fn an_address_names_one_region_only_where_its_counters_and_its_count_agree() {
        let cut = |addresses: &[(&str, &str)]| addresses.iter().map(|(name, path)| ((*name).to_owned(), (*path).to_owned())).collect::<Vec<_>>();
        let both = [("decide", "entry"), ("decide", "if#0/then"), ("decide", "if#1/then")];
        let alike = addressed_alike(cut(&both).into_iter(), cut(&both).into_iter());
        assert!(alike("decide", "if#0/then") && alike("decide", "if#1/then"));
        // The first branch deleted: the second is cut as `if#0`, the address the first had.
        let alike = addressed_alike(cut(&both).into_iter(), cut(&[("decide", "entry"), ("decide", "if#0/then")]).into_iter());
        assert!(!alike("decide", "if#0/then"));
        // The renumbering stays inside the counter it changed.
        assert!(alike("decide", "entry"));
        // Two callbacks of one name where the other cut holds one: no occurrence names either.
        let alike = addressed_alike(cut(&[("c/useEffect.arg0", "entry")]).into_iter(), cut(&[("c/useEffect.arg0", "entry"), ("c/useEffect.arg0", "entry")]).into_iter());
        assert!(!alike("c/useEffect.arg0", "entry"));
    }

    #[test]
    fn an_address_one_cut_lacks_is_disputed_only_where_a_counter_it_passes_through_was_seated_elsewhere() {
        let cut = |addresses: &[(&str, &str)]| addresses.iter().map(|(name, path)| ((*name).to_owned(), (*path).to_owned())).collect::<Vec<_>>();
        let before = cut(&[("decide", "entry"), ("decide", "if#1/then"), ("cb", "entry")]);
        let after = cut(&[("decide", "entry"), ("decide", "if#0/then"), ("cb", "entry"), ("cb", "entry"), ("inner", "entry"), ("inner", "if#0/then")]);
        let standing = addressed(before.into_iter(), after.into_iter());
        assert_eq!(standing("decide", "entry"), Standing::Alike);
        assert_eq!(standing("inner", "entry"), Standing::Lacked);
        assert_eq!(standing("inner", "if#0/then"), Standing::Lacked);
        assert_eq!(standing("cb", "entry"), Standing::Disputed);
        assert_eq!(standing("decide", "if#0/then"), Standing::Disputed);
    }
}
