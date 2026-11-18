//! Opt-in phase timings shared by source indexing and its native consumers.

// compass: variance-authority.reach.source-index

use std::fmt::Display;
use std::time::Instant;

pub(crate) fn enabled() -> bool {
    std::env::var("VARIANCE_SENSE_TIMINGS").is_ok_and(|value| value == "1")
}

/// Each elapsed phase is separate; the total includes all phases and cleanup.
pub(crate) struct Phases {
    scope: &'static str,
    phase: &'static str,
    clock: Option<(Instant, Instant)>,
}

impl Phases {
    pub(crate) fn new(scope: &'static str, phase: &'static str) -> Self {
        let clock = enabled().then(|| { let now = Instant::now(); (now, now) });
        if clock.is_some() { eprintln!("sense {scope} {phase}: started"); }
        Self { scope, phase, clock }
    }

    pub(crate) fn enabled(&self) -> bool { self.clock.is_some() }

    pub(crate) fn note(&self, detail: impl Display) {
        if self.enabled() { eprintln!("sense {}: {detail}", self.scope); }
    }

    pub(crate) fn next(&mut self, phase: &'static str) {
        if let Some((_, began)) = &mut self.clock {
            let now = Instant::now();
            eprintln!("sense {} {}: {:.1} ms", self.scope, self.phase, now.duration_since(*began).as_secs_f64() * 1000.0);
            *began = now;
            eprintln!("sense {} {phase}: started", self.scope);
        }
        self.phase = phase;
    }
}

impl Drop for Phases {
    fn drop(&mut self) {
        if let Some((started, began)) = self.clock {
            let now = Instant::now();
            eprintln!("sense {} {}: {:.1} ms; total {:.1} ms", self.scope, self.phase,
                now.duration_since(began).as_secs_f64() * 1000.0, now.duration_since(started).as_secs_f64() * 1000.0);
        }
    }
}
