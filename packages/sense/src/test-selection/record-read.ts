/**
 * What reads a record without Node: the entry the page `variance view` writes
 * is bundled from. A packed run needs zstd, which no browser has, so the record
 * it reads is `rawRecord`'s.
 */
export { columnBlob, columnBytes, columnWords, members, sectionsOf, stringTable, type OpenedSections, type SetColumns, type TestColumns } from './execution-set-columns.js';
export { openSetColumns, testAt, type SetExecutionModule } from './execution-set-format.js';
export { openTestCoverage, type TestCoverageView } from './format-view.js';
export { BLOCK_KINDS, framedHeader, NO_BLOB, NO_DURATION, NO_OWNER, PHASE_NAMES, type Header, type Section } from './format-layout.js';
export { RecordWithoutCoverage } from './format-validation.js';
export { lineAt, linesOf, lineOf, type CaseLines } from './case-lines.js';
export { shareOf, type CaseTime } from './case-times.js';
export { decodeReadings, type ReadRegion, type StoredReading } from './readings-bytes.js';
export { decodeCase } from './readings-case.js';
