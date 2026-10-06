import { describe, expect, it } from 'vitest';
import { didYouMean, nearest } from './nearest.js';

describe('the name somebody meant', () => {
  it('finds the one a dropped character was taken out of', () => {
    expect(nearest('--quer', ['--query', '--subject', '--limit'])).toBe('--query');
  });

  it('finds the one two neighbours were typed in the wrong order in', () => {
    // A transposition is one mistake and has to score as one: `aks` sits two
    // plain edits from `ask`, which is further than a three-letter word is
    // allowed to reach.
    expect(nearest('aks', ['ask', 'run', 'report'])).toBe('ask');
    expect(nearest('--fromat', ['--format', '--from'])).toBe('--format');
  });

  it('says nothing when two names are equally close', () => {
    // Handing back a choice is not an answer; the accepted set is already printed.
    expect(nearest('--frm', ['--from', '--form'])).toBeUndefined();
  });

  it('says nothing about a word that resembles none of them', () => {
    expect(nearest('elephant', ['--query', '--subject'])).toBeUndefined();
  });

  it('keeps a short word from reaching the whole table', () => {
    // One edit for three characters. `run` and `ran` are a typo; `run` and `report`
    // are two different intentions.
    expect(nearest('--x', ['--all', '--to', '--at'])).toBeUndefined();
  });

  it('answers a name typed in the wrong case with how it is really spelled', () => {
    expect(nearest('--QUERY', ['--query'])).toBe('--query');
  });
});

describe('the line a refusal adds', () => {
  it('is a line of its own, so the list before it stays a list', () => {
    expect(didYouMean('--quer', ['--query'])).toBe('\nDid you mean `--query`?');
  });

  it('is nothing at all when there is nothing to suggest', () => {
    expect(didYouMean('elephant', ['--query'])).toBe('');
  });
});
