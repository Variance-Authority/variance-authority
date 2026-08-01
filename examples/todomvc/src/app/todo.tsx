import type { ReactNode } from 'react';
import { codeMutationIs } from '../code-mutation.js';
import { Button, Card, Chip, Stack, Text, TextField, Toggle } from '../ds/components.js';

/**
 * TodoMVC, assembled entirely from the design system.
 *
 * No component in this file contains a class name, a colour, or a length. Every
 * visual decision is delegated downward — which is what makes the page layer a
 * useful test of *attribution* rather than of rendering.
 *
 * The consequence worth watching: when a token moves, these components produce
 * deltas but are not the cause of any of them. A tool that names `TodoItem` as
 * the thing that changed has confused the messenger with the message, and the
 * whole point of carrying provenance forward is to avoid exactly that.
 */

export interface Todo {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
}

export type Filter = 'all' | 'active' | 'completed';

export interface TodoItemProps {
  readonly todo: Todo;
}

export function TodoItem({ todo }: TodoItemProps): ReactNode {
  return (
    <div className="va-row">
      <Stack direction="row" gap={3}>
        <Toggle id={`toggle-${todo.id}`} checked={todo.done} label={`Mark "${todo.title}" as done`} />
        <Text tone={todo.done ? 'done' : 'default'}>{todo.title}</Text>
      </Stack>
    </div>
  );
}

export interface TodoListProps {
  readonly todos: readonly Todo[];
}

export function TodoList({ todos }: TodoListProps): ReactNode {
  if (todos.length === 0) {
    return (
      <Text tone="muted" as="p">
        Nothing to do. Enjoy it while it lasts.
      </Text>
    );
  }

  return (
    <Stack gap={1}>
      {todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </Stack>
  );
}

export interface TodoHeaderProps {
  readonly draft: string;
}

export function TodoHeader({ draft }: TodoHeaderProps): ReactNode {
  return (
    <Stack gap={3}>
      <Text as="h1" size="lg">
        Todos
      </Text>
      <TextField id="new-todo" label="What needs doing?" value={draft} placeholder="Add a todo" />
    </Stack>
  );
}

export interface TodoFooterProps {
  readonly remaining: number;
  readonly filter: Filter;
}

export function TodoFooter({ remaining, filter }: TodoFooterProps): ReactNode {
  // A page-layer source edit: this component decides its own filter order, so
  // reordering it is an internal change here and not a composition change
  // anywhere above.
  const filters: readonly Filter[] = codeMutationIs('filter-reorder')
    ? ['completed', 'active', 'all']
    : ['all', 'active', 'completed'];

  return (
    <Stack direction="row" gap={2}>
      <Text size="sm" tone="muted">
        {`${remaining} left`}
      </Text>
      {filters.map((candidate) => (
        <Chip key={candidate} label={candidate} selected={candidate === filter} />
      ))}
      <Button variant="danger" label="Clear completed" />
    </Stack>
  );
}

export interface TodoAppProps {
  readonly todos: readonly Todo[];
  readonly filter?: Filter;
  readonly draft?: string;
}

export function TodoApp({ todos, filter = 'all', draft = '' }: TodoAppProps): ReactNode {
  const visible = todos.filter((todo) =>
    filter === 'active' ? !todo.done : filter === 'completed' ? todo.done : true,
  );
  const remaining = todos.filter((todo) => !todo.done).length;

  return (
    <Card>
      <Stack gap={3}>
        <TodoHeader draft={draft} />
        <TodoList todos={visible} />
        <TodoFooter remaining={remaining} filter={filter} />
      </Stack>
    </Card>
  );
}
