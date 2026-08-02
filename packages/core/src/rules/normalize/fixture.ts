import type {
  Declaration,
  MatchedRule,
  RawCapture,
  RawNode,
  Rect,
} from '../../format/capture.js';
import { CHROMIUM_PROFILE, JSDOM_PROFILE, type ObservationProfile } from '../../format/profile.js';
import { propsDigest } from '../../format/provenance.js';

/**
 * Fixture builders for `RawCapture`.
 *
 * These exist because the collector/core split makes them possible: `core` never
 * touches a DOM, so its entire behavior is testable from hand-written data with
 * no browser, no JSDOM, and no React. That is not a testing convenience — it is
 * the property that lets the same normalizer serve a remote sub-renderer
 * (ADR-0002), and these fixtures are how we keep it honest.
 *
 * Exported rather than test-local so collectors can assert that what they emit
 * round-trips through the same shapes.
 */

export interface NodeSpec {
  readonly tag?: string;
  readonly attributes?: Record<string, string>;
  readonly role?: string;
  readonly name?: string;
  readonly description?: string;
  readonly state?: Record<string, string | boolean | number>;
  readonly rules?: readonly RuleSpec[];
  readonly inlineStyle?: Record<string, string>;
  readonly computedStyle?: Record<string, string>;
  readonly rect?: Rect;
  readonly text?: string;
  /**
   * Already-built nodes, not specs.
   *
   * Callers write `node({children: [node({...})]})`, so the children arrive
   * built. Re-running the builder over them would read `spec.rules` off a
   * `RawNode` — which has `matchedRules` — and silently produce a child with no
   * style at all. Every style assertion below such a node would then pass by
   * comparing nothing to nothing.
   */
  readonly children?: readonly RawNode[];

  /**
   * Owner chain, innermost first, with the props each boundary received.
   * Digests are computed with the real `propsDigest`, so attribution tests
   * exercise the shipped rule rather than a stand-in.
   */
  readonly owners?: readonly OwnerSpec[];
}

export interface OwnerSpec {
  readonly name: string;
  readonly props?: Record<string, unknown>;
}

export interface RuleSpec {
  readonly selector: string;
  readonly declare: Record<string, string>;
  readonly specificity?: readonly [number, number, number];
  readonly order?: number;
  readonly sheet?: string;
  readonly important?: boolean;
}

export function node(spec: NodeSpec = {}): RawNode {
  const aria =
    spec.role !== undefined ||
    spec.name !== undefined ||
    spec.description !== undefined ||
    spec.state !== undefined
      ? {
          role: spec.role ?? null,
          name: spec.name ?? null,
          ...(spec.description !== undefined ? { description: spec.description } : {}),
          state: spec.state ?? {},
        }
      : undefined;

  return {
    tag: spec.tag ?? 'div',
    attributes: spec.attributes ?? {},
    ...(aria ? { aria } : {}),
    matchedRules: (spec.rules ?? []).map(rule),
    ...(spec.inlineStyle ? { inlineStyle: spec.inlineStyle } : {}),
    ...(spec.computedStyle ? { computedStyle: spec.computedStyle } : {}),
    ...(spec.rect ? { rect: spec.rect } : {}),
    ...(spec.text !== undefined ? { text: spec.text } : {}),
    ...(spec.owners
      ? {
          provenance: {
            owners: spec.owners.map((owner) => ({
              name: owner.name,
              propsDigest: propsDigest(owner.props ?? {}),
            })),
          },
        }
      : {}),
    children: spec.children ?? [],
  };
}

export function rule(spec: RuleSpec): MatchedRule {
  const declarations: Declaration[] = Object.entries(spec.declare).map(([property, value]) => ({
    property,
    value,
    important: spec.important ?? false,
  }));

  return {
    sheet: spec.sheet ?? 'sheet.css',
    selector: spec.selector,
    specificity: spec.specificity ?? [0, 1, 0],
    order: spec.order ?? 0,
    declarations,
  };
}

export interface CaptureSpec {
  readonly root: RawNode;
  readonly profile?: ObservationProfile;
  readonly inheritedSeed?: Record<string, string>;
  readonly subjectId?: string;
  readonly engine?: string;
  readonly fonts?: readonly string[];
}

export function capture(spec: CaptureSpec): RawCapture {
  const profile = spec.profile ?? JSDOM_PROFILE;

  return {
    captureVersion: 1,
    subject: { id: spec.subjectId ?? 'fixture:subject', kind: 'fixture' },
    profile,
    environment: {
      profile: profile.id,
      engine: spec.engine ?? `${profile.id}@test`,
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' },
      fonts: spec.fonts ?? ['Inter/400/normal/deadbeef'],
      conditions: {},
      assets: {},
    },
    root: spec.root,
    inheritedSeed: spec.inheritedSeed ?? {},
    diagnostics: [],
  };
}

export { JSDOM_PROFILE, CHROMIUM_PROFILE };
