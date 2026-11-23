import { stringify } from 'yaml';

const bytes = value => Buffer.byteLength(stringify(value));
const fileHeaderBytes = Buffer.byteLength('files:\n');
const emptyFilesBytes = bytes({ files: [] });

/** Project recorded membership; source detail remains in the full receipt. */
export function candidateCatalog(evidence, budgetBytes) {
  const files = new Map();
  const observations = evidence.map(({ step, observation }, index) => {
    for (const { file } of observation.files ?? []) {
      const references = files.get(file) ?? [];
      references.push(index);
      files.set(file, references);
    }
    const { status, membershipStatus, unread, qualifications, membershipError, error } = observation;
    return { evidence: index, step, status, membershipStatus,
      fileCount: observation.files?.length, unread, qualifications, membershipError, error };
  });
  const payload = { observations, files: [] };
  let payloadBytes = bytes(payload);
  const counts = { budgetBytes, totalFiles: files.size, totalObservations: evidence.length };
  if (payloadBytes > budgetBytes) return { ...counts, payloadBytes: 0,
    omittedFiles: files.size, omittedObservations: evidence.length };
  for (const [file, references] of files) {
    const row = { file, evidence: references };
    const addedBytes = bytes({ files: [row] }) - fileHeaderBytes
      + (payload.files.length ? 0 : fileHeaderBytes - emptyFilesBytes);
    if (payloadBytes + addedBytes > budgetBytes) continue;
    payload.files.push(row);
    payloadBytes += addedBytes;
  }
  return { ...counts, payloadBytes, omittedFiles: files.size - payload.files.length,
    omittedObservations: 0, payload };
}
