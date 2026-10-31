# @variance-authority/reads

## 0.22.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.19.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.18.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.16.0

### Minor Changes

- e6afc58: A page run records what each page ran and showed

  `routeCollector({ tests })` records, for every page, the code its browser ran,
  the code each server named in `heads` rendered for it under a journey of its
  own, and the files its root names in `data-variance-reads`. A later
  `variance run --since <ref> --suite <name>` photographs only the pages that ran
  a changed line or showed a changed file.

  `@variance-authority/reads` is the attribute's production half: `reads(path)`
  returns the props that name the files an element showed. It has no
  dependencies and no runtime.
