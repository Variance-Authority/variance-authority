import type { Locator, Page } from '@playwright/test';
import type {
  ConsumedLocatorAttention,
  EyesLog,
  LocatorStep,
  TargetSnapshot,
} from './access.js';
import { snapshotArguments } from './arguments.js';

const FACTORIES = new Set([
  'and',
  'filter',
  'first',
  'getByAltText',
  'getByLabel',
  'getByPlaceholder',
  'getByRole',
  'getByTestId',
  'getByText',
  'getByTitle',
  'last',
  'locator',
  'nth',
  'or',
]);

const ACTIONS = new Set([
  'blur',
  'check',
  'clear',
  'click',
  'dblclick',
  'dispatchEvent',
  'dragTo',
  'fill',
  'focus',
  'hover',
  'press',
  'pressSequentially',
  'selectOption',
  'selectText',
  'setChecked',
  'setInputFiles',
  'tap',
  'type',
  'uncheck',
]);

const READS = new Set([
  'all',
  'allInnerTexts',
  'allTextContents',
  'ariaSnapshot',
  'boundingBox',
  'count',
  'elementHandle',
  'elementHandles',
  'evaluate',
  'evaluateAll',
  'getAttribute',
  'inputValue',
  'innerHTML',
  'innerText',
  'isChecked',
  'isDisabled',
  'isEditable',
  'isEnabled',
  'isHidden',
  'isVisible',
  'screenshot',
  'textContent',
  'waitFor',
]);

export type SnapshotLocator = (locator: Locator) => Promise<readonly TargetSnapshot[]>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function step(member: string, arguments_: readonly unknown[]): LocatorStep {
  return { member, arguments: snapshotArguments(arguments_) };
}

async function consume(
  locator: Locator,
  log: EyesLog,
  snapshot: SnapshotLocator,
  path: readonly LocatorStep[],
  operation: ConsumedLocatorAttention['operation'],
  member: string,
  invoke: () => unknown,
): Promise<unknown> {
  const before = await read(snapshot, locator);
  const beforeRead = before === undefined ? {} : { before };

  let result: unknown;
  try {
    result = await invoke();
  } catch (error) {
    log.record({
      kind: 'playwright-locator',
      operation,
      member,
      locator: path,
      ...beforeRead,
      outcome: 'threw',
      error: errorMessage(error),
    });
    throw error;
  }

  const after = await read(snapshot, locator);
  log.record({
    kind: 'playwright-locator',
    operation,
    member,
    locator: path,
    ...beforeRead,
    ...(after === undefined ? {} : { after }),
    outcome: 'resolved',
  });
  return result;
}

/**
 * The Locator's targets, or `undefined` when the page agent could not read
 * them. Navigation, a closed page or a detached frame can lose the read on
 * either side of a call, and an observer may not change what its subject does,
 * so the call runs and returns or throws as it would without Eyes. The entry
 * leaves the lost read out, which says it never completed.
 */
async function read(
  snapshot: SnapshotLocator,
  locator: Locator,
): Promise<readonly TargetSnapshot[] | undefined> {
  try {
    return await snapshot(locator);
  } catch {
    return undefined;
  }
}

/**
 * Record every call a test makes on a Playwright Locator in `log`: each action,
 * read and `expect` assertion with the targets before and after it, and each
 * locator it derives as planned, itself instrumented the same way.
 */
function instrumentLocator(
  locator: Locator,
  log: EyesLog,
  snapshot: SnapshotLocator,
  path: readonly LocatorStep[],
): Locator {
  return new Proxy(locator, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== 'function') return value;

      const member = String(property);
      return (...arguments_: unknown[]) => {
        if (FACTORIES.has(member)) {
          const nextPath = [...path, step(member, arguments_)];
          const result = Reflect.apply(value, target, arguments_) as Locator;
          log.record({ kind: 'playwright-locator', operation: 'planned', locator: nextPath });
          return instrumentLocator(result, log, snapshot, nextPath);
        }

        if (member === '_expect') {
          const matcher = typeof arguments_[0] === 'string' ? arguments_[0] : '_expect';
          return consume(
            target,
            log,
            snapshot,
            path,
            'assertion',
            matcher,
            () => Reflect.apply(value, target, arguments_),
          );
        }

        const operation = ACTIONS.has(member) ? 'action' : READS.has(member) ? 'read' : undefined;
        if (operation !== undefined) {
          return consume(
            target,
            log,
            snapshot,
            path,
            operation,
            member,
            () => Reflect.apply(value, target, arguments_),
          );
        }

        return Reflect.apply(value, target, arguments_);
      };
    },
  });
}

/** Build the fixture's additive `Page` value without changing the runner-owned type. */
export function instrumentPage(
  page: Page,
  log: EyesLog,
  snapshot: SnapshotLocator,
  installCurrentDocument?: () => Promise<void>,
): Page {
  return new Proxy(page, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== 'function') return value;

      const member = String(property);
      return (...arguments_: unknown[]) => {
        if (member === 'setContent' && installCurrentDocument !== undefined) {
          return Promise.resolve(Reflect.apply(value, target, arguments_)).then(async (result) => {
            await installCurrentDocument();
            return result;
          });
        }

        const result = Reflect.apply(value, target, arguments_) as unknown;
        if (!FACTORIES.has(member)) return result;

        const path = [step(member, arguments_)];
        log.record({ kind: 'playwright-locator', operation: 'planned', locator: path });
        return instrumentLocator(result as Locator, log, snapshot, path);
      };
    },
  });
}
