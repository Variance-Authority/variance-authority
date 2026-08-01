import { createElement as h, forwardRef, memo, version, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  resolveProvenance,
  detectReactRuntime,
  findReactContainers,
  NO_FIBER,
} from '../dist/index.js';

const Fancy = forwardRef(function FancyInner(props, ref) {
  return h('i', { ref, 'data-t': 'fancy', className: props.tone });
});
const MemoFancy = memo(Fancy);

function Leaf({ label }) {
  return h('span', { 'data-t': 'leaf' }, label);
}
function Slot({ node }) {
  return h('div', { 'data-t': 'slot' }, node);
}
function Middle({ label }) {
  return h('div', null, h(Leaf, { label }), h(MemoFancy, { tone: 'warm' }));
}
function App({ label }) {
  return h(
    'main',
    null,
    h(Middle, { label }),
    h(Slot, { node: h('b', { 'data-t': 'passed' }, 'hi') }),
  );
}

const container = document.getElementById('root');
const root = createRoot(container);
flushSync(() => root.render(h(App, { label: 'a' })));

const results = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok, actual, expected });
}
const pick = (m) => document.querySelector(`[data-t="${m}"]`);
const owners = (m) => resolveProvenance(pick(m)).provenance.owners.map((f) => f.name);
const digest = (m) => resolveProvenance(pick(m)).provenance.owners[0].propsDigest;

check('owner chain order', owners('leaf'), ['Leaf', 'Middle', 'App']);
check('memo(forwardRef) unwrap', owners('fancy'), ['FancyInner', 'Middle', 'App']);
check('createdBy is the author', resolveProvenance(pick('passed')).provenance.createdBy, 'App');
check('owners[0] is the enclosure', owners('passed')[0], 'Slot');

const d1 = digest('leaf');
flushSync(() => root.render(h(App, { label: 'a' })));
check('digest stable on no-op rerender', digest('leaf'), d1);
flushSync(() => root.render(h(App, { label: 'b' })));
const d2 = digest('leaf');
check('digest moves on prop change', d2 !== d1, true);
flushSync(() => root.render(h(App, { label: 'a' })));
check('digest returns across the alternate flip', digest('leaf'), d1);

const orphan = document.createElement('div');
document.body.appendChild(orphan);
check('no-fiber sentinel', resolveProvenance(orphan), NO_FIBER);
check('container discovered without hook', findReactContainers(document.body).includes(container), true);
check('devtools hook absent', typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__, 'undefined');

const runtime = detectReactRuntime(pick('leaf'));
const summary = {
  userAgent: navigator.userAgent,
  reactVersion: version,
  runtime,
  passed: results.filter((r) => r.ok).length,
  total: results.length,
  failures: results.filter((r) => !r.ok),
};
document.getElementById('out').textContent = JSON.stringify(summary, null, 2);
console.log('VA_BROWSER_CHECK', JSON.stringify(summary));
