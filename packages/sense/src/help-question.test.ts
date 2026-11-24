import { expect, it, vi } from 'vitest';
import { asOneQuestion, onQuestionIndex, questionIdentity } from './help-question.js';

// compass: variance-authority.report.agent-surface

it('shares an identity and handles only within the synchronous outer question', () => {
  expect(questionIdentity()).toBeUndefined();
  const first = { close: vi.fn() };
  const second = { close: vi.fn() };
  const open = vi.fn(() => first);
  let identity: object | undefined;
  asOneQuestion(() => {
    identity = questionIdentity();
    expect(identity).toBeDefined();
    expect(onQuestionIndex('first', open, (held) => held)).toBe(first);
    asOneQuestion(() => {
      expect(questionIdentity()).toBe(identity);
      expect(onQuestionIndex('first', open, (held) => held)).toBe(first);
      expect(onQuestionIndex('second', () => second, (held) => held)).toBe(second);
    });
    expect(first.close).not.toHaveBeenCalled();
  });
  expect(open).toHaveBeenCalledTimes(1);
  expect(first.close).toHaveBeenCalledTimes(1);
  expect(second.close).toHaveBeenCalledTimes(1);
  expect(questionIdentity()).toBeUndefined();
  asOneQuestion(() => expect(questionIdentity()).not.toBe(identity));
});

it('closes after a thrown question and opens direct reads as separate questions', () => {
  const opened = { close: vi.fn() };
  const open = vi.fn(() => opened);
  expect(() => asOneQuestion(() => {
    onQuestionIndex('index', open, () => { throw new Error('stopped'); });
  })).toThrow('stopped');
  expect(questionIdentity()).toBeUndefined();
  onQuestionIndex('index', open, () => undefined);
  onQuestionIndex('index', open, () => undefined);
  expect(open).toHaveBeenCalledTimes(3);
  expect(opened.close).toHaveBeenCalledTimes(3);
});

it('ends a question before an asynchronous continuation runs', async () => {
  const opened = { close: vi.fn() };
  await asOneQuestion(() => {
    onQuestionIndex('index', () => opened, () => undefined);
    return Promise.resolve().then(() => {
      expect(questionIdentity()).toBeUndefined();
      expect(opened.close).toHaveBeenCalledTimes(1);
    });
  });
});
