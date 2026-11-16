//! Batch acquisition timings; source rows are counted only while tracing.

use std::time::{Duration, Instant};

use super::{Named, Opened, Outcome};

pub(super) struct Batch {
    started: Option<Instant>,
    open: Vec<Span>,
    parse: Vec<Span>,
    bytes: u64,
    disk: bool,
    staged: bool,
}

pub(super) struct Span { start: Instant, end: Instant }

impl Span {
    fn elapsed(&self) -> Duration { self.end.duration_since(self.start) }
    fn overlap(&self, other: &Self) -> Duration {
        self.end.min(other.end).saturating_duration_since(self.start.max(other.start))
    }
}

impl Batch {
    pub(super) fn new(disk: bool, staged: bool) -> Self {
        Self { started: crate::timings::enabled().then(Instant::now), open: Vec::new(), parse: Vec::new(), bytes: 0, disk, staged }
    }

    pub(super) fn measure<T>(&self, work: impl FnOnce() -> T) -> (T, Option<Span>) {
        let Some(start) = self.started.map(|_| Instant::now()) else { return (work(), None) };
        let value = work();
        (value, Some(Span { start, end: Instant::now() }))
    }

    pub(super) fn opened(&mut self, elapsed: Option<Span>, rows: &[(&str, Opened, String, bool)]) {
        if self.started.is_none() { return }
        self.open.extend(elapsed);
        self.bytes += rows.iter().filter_map(|(_, opened, _, _)| match opened {
            Opened::Source(source) => Some(source.len() as u64), _ => None,
        }).sum::<u64>();
    }

    pub(super) fn parsed(&mut self, elapsed: Option<Span>) { self.parse.extend(elapsed); }

    pub(super) fn report(&self, rows: &[Named], hits: Option<&[bool]>) {
        let Some(started) = self.started else { return };
        let mut parsed = 0;
        let mut declined = 0;
        let mut failed = 0;
        for (at, ((_, _, outcome), _)) in rows.iter().enumerate() {
            match outcome {
                Outcome::Parsed => parsed += usize::from(!hits.is_some_and(|hits| hits[at])),
                Outcome::Declined => declined += 1,
                Outcome::Failed => failed += 1,
            }
        }
        let cache = hits.map_or(0, |hits| hits.iter().filter(|hit| **hit).count());
        let bytes = if self.staged { self.bytes } else {
            rows.iter().filter_map(|((read, _, _), _)| read.size().map(|size| u64::from(size.bytes))).sum()
        };
        let route = if self.disk { "disk" } else { "Git blobs/disk fallback" };
        let elapsed = started.elapsed();
        eprintln!("sense acquire {route}: {} files, {bytes} bytes, {cache} content-cache hits, {parsed} parsed, {declined} declined, {failed} failed; wall {:.1} ms", rows.len(), elapsed.as_secs_f64() * 1000.0);
        if self.staged {
            let open: Duration = self.open.iter().map(Span::elapsed).sum();
            let parse: Duration = self.parse.iter().map(Span::elapsed).sum();
            let overlap: Duration = self.open.iter().flat_map(|open| self.parse.iter().map(move |parse| open.overlap(parse))).sum();
            let other = elapsed.saturating_sub(open + parse - overlap);
            eprintln!("sense acquire {route} stages: acquisition/hash {:.1} ms; parse {:.1} ms; overlap {:.1} ms; scheduling/settle {:.1} ms", open.as_secs_f64() * 1000.0, parse.as_secs_f64() * 1000.0, overlap.as_secs_f64() * 1000.0, other.as_secs_f64() * 1000.0);
        } else {
            eprintln!("sense acquire Git stages: blob/disk reads, hashing and parsing are interleaved in this batch");
        }
    }
}
