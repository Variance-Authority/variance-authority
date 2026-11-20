use super::*;

/// A table of the tests' own, so no other thread's timing reaches what they assert.
fn table(set: &[(Sum, u64)]) -> Table {
    let table: Table = [const { AtomicU64::new(0) }; COUNT];
    for (sum, nanos) in set {
        table[*sum as usize].store(*nanos, Ordering::Relaxed);
    }
    table
}

fn all_zero(table: &Table) -> bool {
    table.iter().all(|sum| sum.load(Ordering::Relaxed) == 0)
}

#[test]
fn without_the_variable_no_stage_is_timed_and_no_sum_moves() {
    if std::env::var_os("VARIANCE_AUTHORITY_INDEX_STAGES").is_some() {
        return; // the clock is on in this run, so there is no off path to pin
    }
    assert!(!on());
    assert!(start("listing", &LISTING).0.is_none());
    assert!(part(Sum::Inventory).0.is_none());
    assert_eq!(summed(Sum::Resolve, || 7), 7);
    assert!(all_zero(&SUMS));
}

#[test]
fn a_reset_zeroes_the_stages_own_sums_and_no_other() {
    let sums = table(&[(Sum::Read, 3), (Sum::Parse, 2), (Sum::Resolve, 1), (Sum::Locate, 9)]);
    reset(&sums, &WALK);
    assert!(sums.iter().enumerate().all(|(at, sum)| (sum.load(Ordering::Relaxed) == 0) == (at != Sum::Locate as usize)));
    reset(&sums, &LISTING);
    assert!(all_zero(&sums));
}

#[test]
fn the_listing_line_names_each_part_that_ran_in_order_and_resets_it() {
    let sums = table(&[(Sum::Worktree, 415_000_000), (Sum::Inventory, 50_000_000), (Sum::Read, 7)]);
    assert_eq!(taken(&sums, &LISTING), " (inventory 0.050 s, worktree 0.415 s)");
    assert_eq!(sums[Sum::Read as usize].load(Ordering::Relaxed), 7, "the walk's sum is not the listing's");
    assert_eq!(taken(&sums, &LISTING), "");
}

#[test]
fn the_walk_line_names_every_thread_time_with_reading_less_parsing_then_the_wall_time_of_its_indexes() {
    let sums = table(&[(Sum::Read, 3_000_000_000), (Sum::Parse, 1_000_000_000), (Sum::Index, 250_000_000)]);
    assert_eq!(taken(&sums, &WALK), " (thread time: read 2.000 s, parse 1.000 s, resolve 0.000 s; wall: index 0.250 s)");
    assert!(all_zero(&sums));
}

#[test]
fn a_stage_without_sums_adds_nothing_to_its_line() {
    let sums = table(&[(Sum::Locate, 9)]);
    assert_eq!(taken(&sums, &NONE), "");
    assert_eq!(sums[Sum::Locate as usize].load(Ordering::Relaxed), 9);
}
