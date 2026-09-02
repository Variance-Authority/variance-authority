import { describe, expect, it } from 'vitest';
import { FiberTag, type Fiber } from './fiber.js';
import {
  componentFiberPath,
  fiberParentChain,
  fiberSourceLocation,
  walkFiberSubtree,
} from './traversal.js';

function fiber(name: string, tag = FiberTag.FunctionComponent): Fiber {
  const component = { displayName: name };
  return {
    tag,
    key: null,
    elementType: component,
    type: component,
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    alternate: null,
    memoizedProps: {},
  };
}

function link(parent: Fiber, ...children: Fiber[]): void {
  const writable = parent as unknown as { child: Fiber | null };
  writable.child = children[0] ?? null;
  children.forEach((child, index) => {
    (child as unknown as { return: Fiber | null; sibling: Fiber | null }).return = parent;
    (child as unknown as { sibling: Fiber | null }).sibling = children[index + 1] ?? null;
  });
}

describe('bounded Fiber traversal', () => {
  it('walks one subtree in tree order without entering the root sibling', () => {
    const root = fiber('Root', FiberTag.HostRoot);
    const shell = fiber('Shell');
    const button = fiber('Button');
    const aside = fiber('Aside');
    const outside = fiber('Outside');
    link(root, shell, aside);
    link(shell, button);
    (root as unknown as { sibling: Fiber | null }).sibling = outside;

    const names: string[] = [];
    const result = walkFiberSubtree(root, (one) => {
      names.push((one.type as { displayName: string }).displayName);
    });

    expect(names).toEqual(['Root', 'Shell', 'Button', 'Aside']);
    expect(result).toEqual({ visited: 4, truncated: false });
  });

  it('reports a bound instead of returning a quietly partial walk', () => {
    const root = fiber('Root', FiberTag.HostRoot);
    link(root, fiber('One'), fiber('Two'));

    expect(walkFiberSubtree(root, () => undefined, { limit: 2 })).toEqual({
      visited: 2,
      truncated: true,
    });
  });

  it('keeps structural parents separate from composite component frames', () => {
    const root = fiber('Root', FiberTag.HostRoot);
    const shell = fiber('Shell');
    const host = fiber('div', FiberTag.HostComponent);
    link(root, shell);
    link(shell, host);

    expect(fiberParentChain(host).fibers).toEqual([host, shell, root]);
    expect(componentFiberPath(host).fibers).toEqual([shell]);
  });

  it('reads a recorded source from the nearest enclosing composite', () => {
    const component = fiber('Button');
    const host = fiber('button', FiberTag.HostComponent);
    link(component, host);
    (component as unknown as { _debugSource: Fiber['_debugSource'] })._debugSource = {
      fileName: '/repo/Button.tsx',
      lineNumber: 12,
      columnNumber: 4,
    };

    expect(fiberSourceLocation(host)).toEqual({
      file: '/repo/Button.tsx',
      line: 12,
      column: 4,
    });
  });
});
