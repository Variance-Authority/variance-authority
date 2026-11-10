# The machine every containerized CI job runs on: the Playwright image those
# jobs observe in, with the tools they need installed once, here.
#
# Each job used to install them itself, from the Ubuntu mirror, before its
# checkout. Most runs took seconds; a few took over half an hour, when
# `azure.archive.ubuntu.com` served the compiler at 40 kB/s, and a pull
# request's slowest check was set by the mirror rather than by its tests. Built
# here, the mirror is read once per change to this file.
#
# The Playwright image already carries git, which `actions/checkout` needs to
# make a repository rather than unpack an archive. What each tool added here is
# for:
#
# - git-lfs, for the store's test that commits a baseline through the filter,
#   which skips where git-lfs is absent, and for the `lfs` job's pull. Ubuntu's
#   package turns its filter on for every repository, so every checkout would
#   fetch the baselines and `doctor` would find no pointers to name; it is
#   turned off again, and a job that wants the files installs it in its own
#   checkout.
# - build-essential and curl, for the native scanner, built on this machine by
#   `.github/actions/build`, which installs Rust through rustup.
# - strace, for `variance job`, which records what the site's job read and wrote
#   from under the job, whatever language each of its commands is written in.
#
# The image is published by `.github/workflows/ci-image.yml` under this file's
# git blob id, so a workflow names the image by the content it was built from,
# and `tools/boundaries.check.ts` refuses a workflow naming any other tag.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends git-lfs build-essential curl ca-certificates strace \
  && rm -rf /var/lib/apt/lists/* \
  && git lfs uninstall --system \
  && ! git config --system --get-regexp '^filter\.lfs\.'
