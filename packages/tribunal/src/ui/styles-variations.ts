/**
 * A variation drawn as its two pictures: the parent, then the arm, each a small
 * tile linked to its subject page, or a dashed frame where the run kept no image.
 *
 * The tiles answer *what did this variation change*; the subject page is where a
 * picture is read at size.
 */
export const VARIATION_PICTURE_STYLES = `
.va-variation-pair { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; margin: 0.45rem 0 0; padding: 0; }
.va-variation-side { color: inherit; display: grid; gap: 0.2rem; max-width: 220px; text-decoration: none; }
.va-variation-side img { background: var(--va-surface); border: 1px solid var(--va-line); border-radius: 6px; display: block; max-height: 180px; max-width: 100%; object-fit: contain; }
.va-variation-none { align-items: center; border: 1px dashed var(--va-line); border-radius: 6px; color: var(--va-ink-3); display: flex; font-size: 0.75rem; height: 90px; justify-content: center; width: 160px; }
.va-variation-name { font-family: var(--va-mono); font-size: 0.72rem; overflow-wrap: anywhere; }
`;
