import { describe, expect, it } from 'vitest';
import { HELP_TOOLS, search, symbol } from '@variance-authority/help/tools';
import { TOOLS, VANTAGE_TOOLS, toolByName, vantageToolByName } from '@variance-authority/mcp/tools';
import { QUESTIONS, argumentsOf, questionFor, questionOf, takes } from './asking.js';

/**
 * The catalogue is derived, and this is the claim that it stays derived.
 *
 * Each of these would pass against a hand-written table on the day it was
 * written. What they are here for is the day after a tool is added: a table
 * would still pass its own tests while the command line quietly answered one
 * fewer question than the connection does.
 */

describe('the question a tool answers', () => {
  it('is the tool’s name with the transport taken out of it', () => {
    expect(questionOf(toolByName('variance_trace_component')!)).toBe('trace-component');
    expect(questionOf(vantageToolByName('variance_run_signals')!)).toBe('run-signals');
    // The workspace API server has its own namespace on the wire, and the
    // question drops that one too: a reader types `search`, not `docs_search`.
    expect(questionOf(search)).toBe('search');
  });

  it('exists for every tool in all three sets, and for nothing else', () => {
    const named = new Set([...TOOLS, ...VANTAGE_TOOLS, ...HELP_TOOLS].map(questionOf));

    expect(new Set(QUESTIONS.map((question) => questionOf(question.tool)))).toEqual(named);
  });

  it('carries the tool that answers it, per subject', () => {
    // The routing check and the answering call are the same lookup, so a question
    // cannot be sent to a subject nothing can answer it about.
    expect(questionFor('summary').live).toBeUndefined();
    expect(questionFor('run-signals').report).toBeUndefined();
    expect(questionFor('diff').report).toBeDefined();
    expect(questionFor('diff').live).toBeDefined();
    // A source question is about the checkout and nothing else: no report to
    // read it from, no watcher to reach, so neither arm can be handed it.
    expect(questionFor('search').source).toBe(search);
    expect(questionFor('search').report).toBeUndefined();
    expect(questionFor('search').live).toBeUndefined();
    expect(questionFor('locate').source).toBeUndefined();
  });

  it('refuses a name nobody has, by listing the names somebody does', () => {
    expect(() => questionFor('run-signal')).toThrow('`run-signal` is not a question');
    expect(() => questionFor('run-signal')).toThrow('run-signals');
  });
});

describe('what a question takes', () => {
  it('is read off the tool’s schema rather than declared beside it', () => {
    expect(argumentsOf(toolByName('variance_describe')!)).toEqual([
      { flag: '--subject', property: 'subject', placeholder: '<id>', required: true, kind: 'text' },
    ]);
  });

  it('marks a required argument required and an optional one optional', () => {
    expect(takes(toolByName('variance_describe')!)).toBe('  --subject <id>');
    expect(takes(symbol)).toBe('  --name <name> [--package <name>]');
    expect(takes(vantageToolByName('variance_test_signals')!)).toBe('  --test <id>');
    expect(takes(vantageToolByName('variance_run_signals')!)).toContain('[--state <state>]');
  });

  it('says nothing after a question that takes nothing', () => {
    expect(takes(toolByName('variance_summary')!)).toBe('');
    expect(takes(vantageToolByName('variance_self')!)).toBe('');
  });

  it('reads a list and a number as themselves', () => {
    const listed = argumentsOf(toolByName('variance_changelog')!).find(
      (argument) => argument.property === 'subjects',
    );
    const counted = argumentsOf(vantageToolByName('variance_run_signals')!).find(
      (argument) => argument.property === 'limit',
    );

    expect(listed?.kind).toBe('list');
    expect(counted?.kind).toBe('number');
  });
});
