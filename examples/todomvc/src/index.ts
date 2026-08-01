/**
 * `@variance-authority/example-todomvc` — a small product on a small design
 * system on a small token foundation.
 *
 * Built to be *compared against*: three layers, so a change can be attributed to
 * one of them, and a mutation set covering the cases that separate a semantic
 * verification layer from a pixel differ — including two that a camera cannot
 * see at all.
 */

export { TOKENS_CSS, TOKEN_OVERRIDES } from './tokens/foundation.js';
export { DS_CSS, DS_OVERRIDES } from './ds/styles.js';
export * from './ds/components.js';
export * from './app/todo.js';
export { STORIES, STORY_IDS, storyById } from './stories.js';
export type { Story } from './stories.js';
export { setCodeMutation, codeMutationIs } from './code-mutation.js';
export { MUTATIONS, mutationById } from './mutations.js';
export type { Mutation, MutationId } from './mutations.js';
export { renderStory } from './render.js';
export type { RenderOptions, Rendered } from './render.js';
