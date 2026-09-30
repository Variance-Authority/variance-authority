//! Work a call hands off the JavaScript thread, so `variance index` can fold
//! the code map, read the Help value and refresh the lexicon at once rather
//! than one after another, all of it on rayon's one pool.

// compass: variance-authority.reach.source-index

use napi::bindgen_prelude::{AsyncTask, ToNapiValue, TypeName};
use napi::{Env, Task};

type Job<T> = Box<dyn FnOnce() -> napi::Result<T> + Send>;

/// One closure run off the JavaScript thread, its value resolved as is.
pub struct OffThread<T>(Option<Job<T>>);

impl<T: ToNapiValue + TypeName + Send + 'static> Task for OffThread<T> {
    type Output = T;
    type JsValue = T;

    fn compute(&mut self) -> napi::Result<T> {
        let job = self.0.take().ok_or_else(|| napi::Error::from_reason("the work already ran"))?;
        // Run on rayon's pool rather than on libuv's thread, so every job a
        // step hands over shares the one pool sized to the machine, and two at
        // once divide its cores instead of each taking all of them.
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| rayon::scope(|_| job()))).unwrap_or_else(|panic| {
            let said = panic.downcast_ref::<String>().cloned().or_else(|| panic.downcast_ref::<&str>().map(|said| (*said).to_owned()));
            Err(napi::Error::from_reason(said.unwrap_or_else(|| "the addon panicked".to_owned())))
        })
    }

    fn resolve(&mut self, _env: Env, output: T) -> napi::Result<T> {
        Ok(output)
    }
}

/// `job`, run on libuv's pool and resolved as a promise.
pub fn off_thread<T: ToNapiValue + TypeName + Send + 'static>(job: impl FnOnce() -> napi::Result<T> + Send + 'static) -> AsyncTask<OffThread<T>> {
    AsyncTask::new(OffThread(Some(Box::new(job))))
}
