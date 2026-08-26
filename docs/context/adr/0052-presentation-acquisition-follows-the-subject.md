# ADR-0052 — Presentation acquisition follows the subject

**Status:** accepted
**Date:** 2026-08-26

## Context

Presentation sensing acquires one locator and its React portals. The general DOM
collector can wait for every image in the document and can attach React source
provenance to every captured node. Neither operation answers the presentation
question when the selected subject is a navigation bar: an unresolved lazy image
below it can prevent the reading, and the presentation report does not retain
React provenance.

The cost grows with the document even though the caller deliberately chose a
smaller evidence boundary. On a public 944-node navigation capture, computing
unused provenance dominated acquisition.

## Decision

**Default presentation acquisition waits for images inside the selected subject
and its discovered portals, and collects only evidence consumed by the
presentation report.**

Suspense settlement and portal discovery remain subject-aware. Font settlement
remains document-wide because font loading can change geometry inside the
subject. Animation pinning and scrollbar hiding remain collection interventions.
An explicit Playwright stabilization recipe still replaces the default recipe.
An empty recipe is the caller's declaration that a static document such as an
MHTML archive cannot move and has no page clock to settle.

Presentation collection does not request React provenance. The general DOM
collector retains that capability for reports that consume it.

## Consequences

An unrelated incomplete image cannot hold a navigation reading open. A subject
image still settles before its geometry is read. Presentation reports keep the
same graph, computed style, layout, semantic and ARIA evidence while avoiding a
React traversal whose result they discard.

The subject boundary is not a claim that the rest of the document cannot affect
layout. Fonts remain global, and caller-controlled page state can still move the
subject. The decision only prevents resources outside the subject from becoming
mandatory readiness signals without evidence that the report consumes them.
