import type { ReactNode } from "react";
import Attribution from "./Attribution";
import BetterTests from "./BetterTests";
import DiffReport from "./DiffReport";
import EvidenceMap from "./EvidenceMap";
import EvidenceSlices from "./EvidenceSlices";
import Journeys from "./Journeys";
import PresentationPaint from "./PresentationPaint";
import ReasoningLoop from "./ReasoningLoop";
import ReviewLoop from "./ReviewLoop";
import RuntimeEvidence from "./RuntimeEvidence";
import Since from "./Since";
import Subjects from "./Subjects";
import Variations from "./Variations";

const CAPTIONS: Record<string, string> = {
  "better-tests":
    "Keep reusable work and recorded evidence long enough to improve the next run.",
  reasoning:
    "The useful result is either one action supported by the observation or a precise account of what evidence the next question needs.",
  "evidence-field":
    "Source, execution, interface, and history remain independent readings. A question composes only the routes its decision needs.",
  start:
    "The existing host reaches the state. Observation, review, and acceptance add a durable comparison without taking that responsibility away.",
  surface:
    "The same observation model can address several kinds of subject without pretending they need the same retained evidence.",
  attribution:
    "A region is the start of the explanation: document and React evidence carry it to an owner and, where provenance exists, a source location.",
  variations:
    "Related subjects keep separate baselines while their cross-variant difference becomes evidence of its own.",
  composition:
    "The review keeps repeated causes together and leaves states with additional evidence open.",
  selecting:
    "Static reach explains what a change could affect; prior execution evidence names the tests that actually entered it.",
  instruments:
    "Independent readings stay independent, so an absent signal cannot be mistaken for an observed empty result.",
  presentation:
    "A focused report paints the repeated records and the relationship finding it measured. The overlay identifies evidence; it does not prescribe a design change.",
  journeys:
    "One decision is one mark, however many regions the run records for it. An arm that entered is lit, and the line that fell through is dashed.",
};

function Figure({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure className="doc-figure">
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export default function DocumentFigure({ slug }: { slug: string }) {
  switch (slug) {
    case "better-tests":
      return (
        <Figure caption={CAPTIONS["better-tests"]!}>
          <BetterTests />
        </Figure>
      );
    case "reasoning":
      return (
        <Figure caption={CAPTIONS.reasoning!}>
          <ReasoningLoop />
        </Figure>
      );
    case "evidence-field":
      return (
        <Figure caption={CAPTIONS["evidence-field"]!}>
          <EvidenceMap />
        </Figure>
      );
    case "start":
      return (
        <Figure caption={CAPTIONS.start!}>
          <ReviewLoop />
        </Figure>
      );
    case "surface":
      return (
        <Figure caption={CAPTIONS.surface!}>
          <Subjects />
        </Figure>
      );
    case "attribution":
      return (
        <Figure caption={CAPTIONS.attribution!}>
          <Attribution />
        </Figure>
      );
    case "variations":
      return (
        <Figure caption={CAPTIONS.variations!}>
          <Variations />
        </Figure>
      );
    case "composition":
      return (
        <Figure caption={CAPTIONS.composition!}>
          <DiffReport />
        </Figure>
      );
    case "selecting":
      return (
        <Figure caption={CAPTIONS.selecting!}>
          <div className="grid gap-5 2xl:grid-cols-2 [&>*]:min-w-0">
            <Since />
            <RuntimeEvidence />
          </div>
        </Figure>
      );
    case "instruments":
      return (
        <Figure caption={CAPTIONS.instruments!}>
          <EvidenceSlices />
        </Figure>
      );
    case "presentation":
      return (
        <Figure caption={CAPTIONS.presentation!}>
          <PresentationPaint />
        </Figure>
      );
    case "journeys":
      return (
        <Figure caption={CAPTIONS.journeys!}>
          <Journeys />
        </Figure>
      );
    default:
      return null;
  }
}
