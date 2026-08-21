// Not an entrypoint, and reaching for a subpath `alpha` does not publish. Both
// halves matter: a consumer is any file under a manifest, and a door nobody
// opened is still a door somebody walked through.
import { Level } from 'alpha/values';
import * as everything from 'alpha';
import type { Shape } from 'alpha';

export const level: Level = Level.Low;
export const shapes: typeof everything.shapes = everything.shapes;
export const sides = (shape: Shape): number => shape.sides;
