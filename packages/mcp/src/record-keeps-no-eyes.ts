// compass: variance-authority/runtime/attention

/**
 * A record that reads, written by a run that did not opt into Eyes. Distinct
 * from a record that does not read, which a reload rides out.
 */
export class RecordKeepsNoEyes extends Error {
  constructor(readonly record: string) {
    super(`the record at ${record} keeps no Eyes journals: the run that wrote it did not opt into Eyes`);
  }
}
