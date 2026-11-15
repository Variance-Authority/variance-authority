/** A source of the time. */
export interface Clock {
  /** The time now, in milliseconds. */
  now(): number;
  zone: string;
}
