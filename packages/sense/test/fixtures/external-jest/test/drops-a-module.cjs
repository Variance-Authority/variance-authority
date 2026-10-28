// A recorder defect, made on purpose: the file's journal loses `src/decide.ts`,
// from what loaded before its first case and from what its cases entered,
// though the file evaluated it and its probes registered.
const collector = globalThis[Symbol.for('variance-authority.test-selection.collector')];
const lost = (modules) => new Map([...modules].filter(([id]) => !id.includes('/src/decide.ts@')));
const seal = collector.seal.bind(collector);
const finish = collector.finish.bind(collector);
collector.seal = (testFile) => lost(seal(testFile));
collector.finish = (testFile) => {
  const finished = finish(testFile);
  return { ...finished, modules: lost(finished.modules) };
};
