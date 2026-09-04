# Edge platform

## What it is

The operator's own Cloudflare account: Workers as the runtime, D1 as the row
store, R2 as the image store, and Access as the identity provider that says
which person is looking. The system is deployed into it and never hosted for
anyone.

## Good at

Being somebody's own. Every row, every image and every **decision** stays
inside an account the adopter already controls, which is the whole reason this
surface exists rather than a hosted one.

## Bad at

Coordinating a migration. There is no advisory lock, so nothing may migrate on
request; the schema is applied deliberately and never as a side effect of a
first visit.

## How it breaks

A misconfigured identity origin turns a review surface into an anonymous one,
so the surface is not drawn at all when the identity configuration is absent. A
settable header impersonates a verified identity, so the signature is checked
rather than the header trusted. A service token authenticates a machine, and a
machine may write evidence but may not decide it.

## How you talk to it

Bindings, not URLs: a database binding, a bucket binding, an assets binding, and
a signed identity assertion on the request. Two secrets that may never be the
same value — one that may write a **candidate**, one that may promote it.

## Their chart

—
