import type { ReactNode } from 'react';
import { Button, Card, Chip, Stack, Text, TextField, Toggle } from './ds/components.js';
import { TodoApp, TodoFooter, TodoItem, type Todo } from './app/todo.js';

/**
 * The story set: a design-system layer and a page layer, as a real repository
 * has.
 *
 * The two layers exist so the comparison has something to be *about*. A change
 * to the foundation reaches both; a change to a component reaches the pages that
 * use it and no others; a change to a page reaches only itself. A tool that
 * reports "N screenshots differ" describes all three identically.
 */

const TODOS: readonly Todo[] = [
  { id: 'a', title: 'Write the spec', done: true },
  { id: 'b', title: 'Prove the tiering', done: false },
  { id: 'c', title: 'Ship the docket', done: false },
];

export interface Story {
  readonly id: string;
  readonly layer: 'ds' | 'page';
  readonly render: () => ReactNode;
}

export const STORIES: readonly Story[] = [
  // Design-system layer.
  { id: 'ds/button--default', layer: 'ds', render: () => <Button label="Save" /> },
  { id: 'ds/button--primary', layer: 'ds', render: () => <Button variant="primary" label="Save" /> },
  { id: 'ds/button--danger', layer: 'ds', render: () => <Button variant="danger" label="Clear" /> },
  {
    id: 'ds/text--scale',
    layer: 'ds',
    render: () => (
      <Stack gap={1}>
        <Text as="h1" size="lg">Heading</Text>
        <Text>Body copy</Text>
        <Text size="sm" tone="muted">Caption</Text>
      </Stack>
    ),
  },
  {
    id: 'ds/toggle--states',
    layer: 'ds',
    render: () => (
      <Stack direction="row" gap={3}>
        <Toggle id="t-off" checked={false} label="Off" />
        <Toggle id="t-on" checked label="On" />
      </Stack>
    ),
  },
  {
    id: 'ds/field--empty',
    layer: 'ds',
    render: () => <TextField id="f1" label="What needs doing?" value="" placeholder="Add a todo" />,
  },
  {
    id: 'ds/chip--group',
    layer: 'ds',
    render: () => (
      <Stack direction="row" gap={2}>
        <Chip label="all" selected />
        <Chip label="active" />
        <Chip label="completed" />
      </Stack>
    ),
  },
  { id: 'ds/card--basic', layer: 'ds', render: () => <Card><Text>Contents</Text></Card> },

  // Page layer.
  {
    id: 'page/todos--empty',
    layer: 'page',
    render: () => <TodoApp todos={[]} />,
  },
  {
    id: 'page/todos--populated',
    layer: 'page',
    render: () => <TodoApp todos={TODOS} />,
  },
  {
    id: 'page/todos--active-filter',
    layer: 'page',
    render: () => <TodoApp todos={TODOS} filter="active" />,
  },
  {
    id: 'page/todos--completed-filter',
    layer: 'page',
    render: () => <TodoApp todos={TODOS} filter="completed" />,
  },
  {
    id: 'page/todos--drafting',
    layer: 'page',
    render: () => <TodoApp todos={TODOS} draft="Buy milk" />,
  },
  {
    id: 'page/item--done',
    layer: 'page',
    render: () => <TodoItem todo={TODOS[0]!} />,
  },
  {
    id: 'page/footer--counts',
    layer: 'page',
    render: () => <TodoFooter remaining={2} filter="all" />,
  },
];

export const STORY_IDS: readonly string[] = STORIES.map((story) => story.id);

export function storyById(id: string): Story {
  const story = STORIES.find((candidate) => candidate.id === id);
  if (!story) throw new Error(`unknown story: ${id}`);
  return story;
}
