//! Work a call hands off the JavaScript thread, so `variance index` can fold
//! the code map, read the Help value and refresh the lexicon at once rather
//! than one after another. Libuv coordinates each job; parallel work shares Rayon.

// compass: variance-authority.reach.source-index

use napi::bindgen_prelude::{AsyncTask, ToNapiValue, TypeName};
use napi::{Env, Task};
use crate::timings::Phases;

type Job<T> = Box<dyn FnOnce() -> napi::Result<T> + Send>;

/// One closure run off the JavaScript thread, its value resolved as is.
pub struct OffThread<T> {
    job: Option<Job<T>>,
    phases: Option<Phases>,
}

impl<T: ToNapiValue + TypeName + Send + 'static> Task for OffThread<T> {
    type Output = T;
    type JsValue = T;

    fn compute(&mut self) -> napi::Result<T> {
        let job = self.job.take().ok_or_else(|| napi::Error::from_reason("the work already ran"))?;
        let mut phases = self.phases.take();
        // Libuv owns the job's coordinator. Its parallel operations enter the
        // shared Rayon pool without making the whole job stealable.
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if let Some(phases) = &mut phases { phases.next("execution"); }
            job()
        })).unwrap_or_else(|panic| {
            let said = panic.downcast_ref::<String>().cloned().or_else(|| panic.downcast_ref::<&str>().map(|said| (*said).to_owned()));
            Err(napi::Error::from_reason(said.unwrap_or_else(|| "the addon panicked".to_owned())))
        })
    }

    fn resolve(&mut self, _env: Env, output: T) -> napi::Result<T> {
        Ok(output)
    }
}

/// `job`, run on libuv's pool and resolved as a promise.
pub fn off_thread<T: ToNapiValue + TypeName + Send + 'static>(scope: &'static str, job: impl FnOnce() -> napi::Result<T> + Send + 'static) -> AsyncTask<OffThread<T>> {
    AsyncTask::new(OffThread { job: Some(Box::new(job)), phases: Some(Phases::new(scope, "libuv queue")) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rayon::prelude::*;

    fn task(job: impl FnOnce() -> napi::Result<String> + Send + 'static) -> OffThread<String> {
        OffThread { job: Some(Box::new(job)), phases: None }
    }

    fn consumed(task: &mut OffThread<String>) {
        assert_eq!(task.compute().unwrap_err().reason, "the work already ran");
    }

    #[test]
    fn preserves_success_and_consumes_the_job_once() {
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = std::sync::Arc::clone(&calls);
        let mut work = task(move || {
            counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let doubled: Vec<_> = (0..8).into_par_iter().map(|value| value * 2).collect();
            assert_eq!(doubled, (0..8).map(|value| value * 2).collect::<Vec<_>>());
            Ok("completed".to_owned())
        });
        assert_eq!(work.compute().unwrap(), "completed");
        consumed(&mut work);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn preserves_result_errors_and_consumes_the_job_once() {
        let mut work = task(|| Err(napi::Error::new(napi::Status::InvalidArg, "original failure")));
        let error = work.compute().unwrap_err();
        assert_eq!(error.status, napi::Status::InvalidArg);
        assert_eq!(error.reason, "original failure");
        consumed(&mut work);
    }

    #[test]
    fn preserves_panic_messages_and_consumes_the_job_once() {
        let panics: [(Job<String>, &str); 3] = [
            (Box::new(|| panic!("borrowed panic")), "borrowed panic"),
            (Box::new(|| std::panic::panic_any("owned panic".to_owned())), "owned panic"),
            (Box::new(|| std::panic::panic_any(7u8)), "the addon panicked"),
        ];
        for (job, expected) in panics {
            let mut work = OffThread { job: Some(job), phases: None };
            let error = work.compute().unwrap_err();
            assert_eq!(error.status, napi::Status::GenericFailure);
            assert_eq!(error.reason, expected);
            consumed(&mut work);
        }
    }

    #[test]
    fn keeps_the_job_on_its_plain_thread_coordinator() {
        let outside_rayon = std::thread::spawn(|| {
            assert!(rayon::current_thread_index().is_none(), "the witness starts on a plain thread");
            let coordinator = std::thread::current().id();
            let mut work = OffThread {
                job: Some(Box::new(move || Ok(
                    rayon::current_thread_index().is_none() && std::thread::current().id() == coordinator
                ))),
                phases: None,
            };
            work.compute().unwrap()
        }).join().unwrap();
        assert!(outside_rayon, "the top-level job must stay on its calling coordinator outside Rayon");
    }
}
