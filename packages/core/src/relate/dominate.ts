// compass: variance-authority.reach
/**
 * Dominance over a graph with one root.
 *
 * D dominates N when every path from the root to N passes through D; N's
 * immediate dominator is the nearest such D, and the immediate dominators form
 * a tree. Cooper, Harvey and Kennedy's iterative algorithm ("A Simple, Fast
 * Dominance Algorithm", 2001): intersect the predecessors' dominators in
 * reverse postorder until nothing changes. It holds on cycles, and on the graphs
 * an import walk produces it settles in two or three passes.
 */

/**
 * Each node the root reaches, mapped to its immediate dominator. The root and
 * every node it does not reach are absent.
 *
 * `successors` is the graph as the caller sees it: a walk that cuts an edge
 * leaves the edge out here.
 */
export function dominatorsOf(
  root: string,
  successors: (node: string) => Iterable<string>,
): ReadonlyMap<string, string> {
  // Postorder by an explicit stack: an import chain is deeper than a call stack likes.
  const order: string[] = [];
  const number = new Map<string, number>();
  const predecessors = new Map<string, string[]>();
  const seen = new Set([root]);
  const stack: { node: string; next: Iterator<string> }[] = [{ node: root, next: successors(root)[Symbol.iterator]() }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const step = top.next.next();
    if (step.done === true) {
      stack.pop();
      number.set(top.node, order.length);
      order.push(top.node);
      continue;
    }
    const child = step.value;
    const into = predecessors.get(child);
    if (into === undefined) predecessors.set(child, [top.node]);
    else into.push(top.node);
    if (seen.has(child)) continue;
    seen.add(child);
    stack.push({ node: child, next: successors(child)[Symbol.iterator]() });
  }

  const idom = new Map<string, string>([[root, root]]);
  const intersect = (left: string, right: string): string => {
    let a = left;
    let b = right;
    while (a !== b) {
      while (number.get(a)! < number.get(b)!) a = idom.get(a)!;
      while (number.get(b)! < number.get(a)!) b = idom.get(b)!;
    }
    return a;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (let at = order.length - 2; at >= 0; at -= 1) {
      const node = order[at]!;
      let next: string | undefined;
      for (const from of predecessors.get(node) ?? []) {
        if (!idom.has(from)) continue;
        next = next === undefined ? from : intersect(from, next);
      }
      if (next !== undefined && idom.get(node) !== next) {
        idom.set(node, next);
        changed = true;
      }
    }
  }
  idom.delete(root);
  return idom;
}
