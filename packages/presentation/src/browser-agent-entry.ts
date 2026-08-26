import {
  acquirePresentation,
  clearPresentationPaint,
  paintPresentation,
  PRESENTATION_AGENT,
  PRESENTATION_AGENT_VERSION,
  type InstalledPresentationAgent,
} from './browser-agent.js';

(globalThis as unknown as Record<string, InstalledPresentationAgent>)[PRESENTATION_AGENT] = {
  acquire: acquirePresentation,
  paint: paintPresentation,
  clear: clearPresentationPaint,
  version: PRESENTATION_AGENT_VERSION,
};
