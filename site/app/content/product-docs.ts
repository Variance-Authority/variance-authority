import architecture from "../../../docs/architecture.md?raw";
import agentCli from "../../../docs/agent-cli.md?raw";
import agentLiveRun from "../../../docs/agent-live-run.md?raw";
import agentMcp from "../../../docs/agent-mcp.md?raw";
import agentQuestions from "../../../docs/agent-questions.md?raw";
import agents from "../../../docs/agents.md?raw";
import agentWorkspaceApi from "../../../docs/agent-workspace-api.md?raw";
import attribution from "../../../docs/attribution.md?raw";
import cases from "../../../docs/cases.md?raw";
import changelog from "../../../docs/changelog.md?raw";
import comparison from "../../../docs/comparison.md?raw";
import composeObservation from "../../../docs/compose-observation.md?raw";
import composition from "../../../docs/composition.md?raw";
import distance from "../../../docs/distance.md?raw";
import distill from "../../../docs/distill.md?raw";
import explainVariance from "../../../docs/explain-variance.md?raw";
import eyes from "../../../docs/eyes.md?raw";
import flakiness from "../../../docs/flakiness.md?raw";
import flows from "../../../docs/flows.md?raw";
import framework from "../../../docs/framework.md?raw";
import gates from "../../../docs/gates.md?raw";
import history from "../../../docs/history.md?raw";
import ignores from "../../../docs/ignores.md?raw";
import index from "../../../docs/README.md?raw";
import information from "../../../docs/information.md?raw";
import instruments from "../../../docs/instruments.md?raw";
import journeys from "../../../docs/journeys.md?raw";
import lexicon from "../../../docs/lexicon.md?raw";
import metrics from "../../../docs/metrics.md?raw";
import nativeCode from "../../../docs/native-code.md?raw";
import observability from "../../../docs/observability.md?raw";
import parting from "../../../docs/parting.md?raw";
import placement from "../../../docs/placement.md?raw";
import presentation from "../../../docs/presentation.md?raw";
import performance from "../../../docs/performance.md?raw";
import replacing from "../../../docs/replacing.md?raw";
import runRelevantWork from "../../../docs/run-relevant-work.md?raw";
import scenarios from "../../../docs/scenarios.md?raw";
import sensitivity from "../../../docs/sensitivity.md?raw";
import selecting from "../../../docs/selecting.md?raw";
import sharing from "../../../docs/sharing.md?raw";
import sourceIndex from "../../../docs/source-index.md?raw";
import sourceStructures from "../../../docs/source-structures.md?raw";
import executionRecord from "../../../docs/execution-record.md?raw";
import source from "../../../docs/source.md?raw";
import stabilization from "../../../docs/stabilization.md?raw";
import start from "../../../docs/start.md?raw";
import startCli from "../../../docs/start-cli.md?raw";
import startCustom from "../../../docs/start-custom.md?raw";
import startPlaywright from "../../../docs/start-playwright.md?raw";
import startRoutes from "../../../docs/start-routes.md?raw";
import startStorybook from "../../../docs/start-storybook.md?raw";
import startUnit from "../../../docs/start-unit.md?raw";
import surface from "../../../docs/surface.md?raw";
import understandExecution from "../../../docs/understand-execution.md?raw";
import understandInterface from "../../../docs/understand-interface.md?raw";
import vantage from "../../../docs/vantage.md?raw";
import variations from "../../../docs/variations.md?raw";

export interface ProductDocument {
  slug: string;
  source: string;
  sourcePath: string;
}

const documents = [
  ["overview", index, "docs/README.md"],
  ["run-relevant-work", runRelevantWork, "docs/run-relevant-work.md"],
  ["understand-execution", understandExecution, "docs/understand-execution.md"],
  ["understand-interface", understandInterface, "docs/understand-interface.md"],
  ["explain-variance", explainVariance, "docs/explain-variance.md"],
  ["compose-observation", composeObservation, "docs/compose-observation.md"],
  ["start", start, "docs/start.md"],
  ["start-playwright", startPlaywright, "docs/start-playwright.md"],
  ["start-storybook", startStorybook, "docs/start-storybook.md"],
  ["start-routes", startRoutes, "docs/start-routes.md"],
  ["start-unit", startUnit, "docs/start-unit.md"],
  ["start-custom", startCustom, "docs/start-custom.md"],
  ["start-cli", startCli, "docs/start-cli.md"],
  ["agents", agents, "docs/agents.md"],
  ["agent-questions", agentQuestions, "docs/agent-questions.md"],
  ["agent-cli", agentCli, "docs/agent-cli.md"],
  ["agent-mcp", agentMcp, "docs/agent-mcp.md"],
  ["agent-live-run", agentLiveRun, "docs/agent-live-run.md"],
  ["agent-workspace-api", agentWorkspaceApi, "docs/agent-workspace-api.md"],
  ["surface", surface, "docs/surface.md"],
  ["flows", flows, "docs/flows.md"],
  ["cases", cases, "docs/cases.md"],
  ["replacing", replacing, "docs/replacing.md"],
  ["gates", gates, "docs/gates.md"],
  ["comparison", comparison, "docs/comparison.md"],
  ["attribution", attribution, "docs/attribution.md"],
  ["ignores", ignores, "docs/ignores.md"],
  ["sensitivity", sensitivity, "docs/sensitivity.md"],
  ["variations", variations, "docs/variations.md"],
  ["composition", composition, "docs/composition.md"],
  ["changelog", changelog, "docs/changelog.md"],
  ["placement", placement, "docs/placement.md"],
  ["history", history, "docs/history.md"],
  ["stabilization", stabilization, "docs/stabilization.md"],
  ["flakiness", flakiness, "docs/flakiness.md"],
  ["framework", framework, "docs/framework.md"],
  ["parting", parting, "docs/parting.md"],
  ["source", source, "docs/source.md"],
  ["selecting", selecting, "docs/selecting.md"],
  ["distance", distance, "docs/distance.md"],
  ["distill", distill, "docs/distill.md"],
  ["source-index", sourceIndex, "docs/source-index.md"],
  ["source-structures", sourceStructures, "docs/source-structures.md"],
  ["execution-record", executionRecord, "docs/execution-record.md"],
  ["observability", observability, "docs/observability.md"],
  ["journeys", journeys, "docs/journeys.md"],
  ["lexicon", lexicon, "docs/lexicon.md"],
  ["presentation", presentation, "docs/presentation.md"],
  ["scenarios", scenarios, "docs/scenarios.md"],
  ["vantage", vantage, "docs/vantage.md"],
  ["architecture", architecture, "docs/architecture.md"],
  ["eyes", eyes, "docs/eyes.md"],
  ["information", information, "docs/information.md"],
  ["instruments", instruments, "docs/instruments.md"],
  ["metrics", metrics, "docs/metrics.md"],
  ["native-code", nativeCode, "docs/native-code.md"],
  ["performance", performance, "docs/performance.md"],
  ["sharing", sharing, "docs/sharing.md"],
] as const;

export const PRODUCT_DOCUMENTS: readonly ProductDocument[] = documents.map(
  ([slug, documentSource, sourcePath]) => ({
    slug,
    source: documentSource,
    sourcePath,
  }),
);

export function productDocument(slug: string): ProductDocument | undefined {
  return PRODUCT_DOCUMENTS.find((document) => document.slug === slug);
}
