/**
 * Every page of the review surface, over the recorded builds.
 *
 * `ReviewApp` as the browser entry mounts it, given the route instead of reading
 * the address bar, and a navigate that goes nowhere: a story is one page, and a
 * click that rewrote the frame's history would leave the next story somewhere
 * else.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReviewApp } from '../src/ui/review.js';
import type { Route } from '../src/ui/route.js';
import { CHANGED, replayClient } from './replay.js';

const client = replayClient();

const meta = {
  title: 'Tribunal/Pages',
  component: ReviewApp,
  parameters: { page: true },
  args: { client, reviewer: 'marina', onNavigate: () => {} },
} satisfies Meta<typeof ReviewApp>;

export default meta;
type Story = StoryObj<typeof meta>;

const at = (route: Route): Story => ({ args: { route } });

export const Builds = at({ page: 'builds' });
export const Docket = at({ page: 'build', build: CHANGED });
export const FirstRun = at({ page: 'build', build: 'ci-101' });
export const Change = at({ page: 'change', build: CHANGED, change: 'Button' });
export const SubjectPending = at({ page: 'subject', build: CHANGED, subject: 'story:case-surface--composed' });
export const SubjectApproved = at({ page: 'subject', build: CHANGED, subject: 'story:case-surface--button-primary' });
export const SubjectUnchanged = at({ page: 'subject', build: CHANGED, subject: 'story:case-surface--loading' });
export const Run = at({ page: 'run', build: CHANGED });
export const Changelog = at({ page: 'changelog' });
