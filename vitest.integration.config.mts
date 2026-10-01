import { withTestSelection } from '@variance-authority/sense/vitest';
import { selectionOf, slice } from './vitest.config.mts';

/** The `integration` slice and its record. `vitest.config.mts` says what each slice is for. */
export default withTestSelection(slice('integration'), selectionOf('integration'));
