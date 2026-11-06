// One name declared twice: each export is the kind its own statement declares.
export const Shade = 'dark';
export type Shade = typeof Shade;

export default function paint(): void {}
