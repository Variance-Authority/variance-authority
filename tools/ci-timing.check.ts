import { describe, expect, it } from 'vitest';
import { timingSummary } from './ci-timing.mjs';

const step = (name: string, start: number, seconds: number, conclusion = 'success') => ({
  name, conclusion, started_at: new Date(start * 1000).toISOString(), completed_at: new Date((start + seconds) * 1000).toISOString(),
});

describe('the required check timing summary', () => {
  it('separates build, selection, execution and reporting from setup using observed timestamps', () => {
    const text = timingSummary([{ name: 'suite (unit)', started_at: new Date(0).toISOString(), completed_at: new Date(100_000).toISOString(), steps: [
      step('install', 0, 10), step('Run ./.github/actions/build', 10, 20), step('plan suite jobs', 30, 5),
      step('test', 35, 40), step('fold the slices', 75, 15), step('test', 90, 0, 'skipped'),
    ] }], 0, 105_000);
    expect(text).toContain('| suite (unit) | 10 s | 20 s | 5 s | 40 s | 15 s | 100 s |');
    expect(text).toContain('105 s');
  });
  it('does not invent zero durations for an unfinished or unavailable timestamp', () => {
    expect(timingSummary([{ name: 'pending', steps: [{ name: 'test', conclusion: null }] }], undefined, 10_000)).toContain('unknown');
  });
  it('omits jobs skipped by this event and identifies work outside the required gate', () => {
    const text = timingSummary([{ name: 'queue expression', conclusion: 'skipped', steps: [] }, { name: 'cases', steps: [] }], 0, 1000);
    expect(text).not.toContain('queue expression');
    expect(text).toContain('cases (non-gating)');
  });
  it('uses elapsed time rather than summing parallel jobs, and escapes table text', () => {
    const jobs = ['suite | one', 'suite two'].map((name) => ({ name, started_at: new Date(0).toISOString(), completed_at: new Date(50_000).toISOString(), steps: [step('test', 0, 50)] }));
    const text = timingSummary(jobs, 0, 55_000);
    expect(text).toContain('55 s');
    expect(text).toContain('suite \\| one');
  });
});
