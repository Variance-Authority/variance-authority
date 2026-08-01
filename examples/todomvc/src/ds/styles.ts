/**
 * The design system's stylesheet.
 *
 * One rule of authorship, applied without exception: **no literal values**.
 * Every colour, length, radius, and font here is a `var(--va-…)` reference.
 *
 * Look for the absence rather than the presence — there is no `12px`, no
 * `#2d6cdf`, no `6px` anywhere below. That is what lets a single token edit
 * resolve to one docket root instead of thirty unrelated style diffs, and it is
 * the discipline a real design system is judged on here.
 */
export const DS_CSS = `
.va-stack { display: flex; flex-direction: column; }
.va-stack--row { flex-direction: row; align-items: center; }
.va-stack--gap-1 { gap: var(--va-space-1); }
.va-stack--gap-2 { gap: var(--va-space-2); }
.va-stack--gap-3 { gap: var(--va-space-3); }

.va-text {
  font-family: var(--va-font-family);
  font-size: var(--va-font-size-md);
  line-height: var(--va-line-height);
  color: var(--va-color-text);
  margin: 0;
}
.va-text--sm { font-size: var(--va-font-size-sm); }
.va-text--lg { font-size: var(--va-font-size-lg); font-weight: var(--va-font-weight-strong); }
.va-text--muted { color: var(--va-color-muted); }
.va-text--done { color: var(--va-color-done); text-decoration-line: line-through; }

.va-button {
  font-family: var(--va-font-family);
  font-size: var(--va-font-size-sm);
  line-height: var(--va-line-height);
  padding-top: var(--va-space-1);
  padding-bottom: var(--va-space-1);
  padding-left: var(--va-space-3);
  padding-right: var(--va-space-3);
  border-top-width: var(--va-border-width);
  border-right-width: var(--va-border-width);
  border-bottom-width: var(--va-border-width);
  border-left-width: var(--va-border-width);
  border-top-style: solid;
  border-right-style: solid;
  border-bottom-style: solid;
  border-left-style: solid;
  border-top-color: var(--va-color-border);
  border-right-color: var(--va-color-border);
  border-bottom-color: var(--va-color-border);
  border-left-color: var(--va-color-border);
  border-top-left-radius: var(--va-radius-md);
  border-top-right-radius: var(--va-radius-md);
  border-bottom-right-radius: var(--va-radius-md);
  border-bottom-left-radius: var(--va-radius-md);
  background-color: var(--va-color-bg);
  color: var(--va-color-text);
}
.va-button--primary {
  background-color: var(--va-color-accent);
  border-top-color: var(--va-color-accent);
  border-right-color: var(--va-color-accent);
  border-bottom-color: var(--va-color-accent);
  border-left-color: var(--va-color-accent);
  color: var(--va-color-bg);
}
.va-button--danger { color: var(--va-color-danger); }

.va-field {
  font-family: var(--va-font-family);
  font-size: var(--va-font-size-md);
  line-height: var(--va-line-height);
  color: var(--va-color-text);
  padding-top: var(--va-space-2);
  padding-bottom: var(--va-space-2);
  padding-left: var(--va-space-3);
  padding-right: var(--va-space-3);
  border-top-width: var(--va-border-width);
  border-right-width: var(--va-border-width);
  border-bottom-width: var(--va-border-width);
  border-left-width: var(--va-border-width);
  border-top-style: solid;
  border-right-style: solid;
  border-bottom-style: solid;
  border-left-style: solid;
  border-top-color: var(--va-color-border);
  border-right-color: var(--va-color-border);
  border-bottom-color: var(--va-color-border);
  border-left-color: var(--va-color-border);
  border-top-left-radius: var(--va-radius-md);
  border-top-right-radius: var(--va-radius-md);
  border-bottom-right-radius: var(--va-radius-md);
  border-bottom-left-radius: var(--va-radius-md);
  background-color: var(--va-color-bg);
  width: 100%;
}

.va-toggle {
  width: var(--va-space-4);
  height: var(--va-space-4);
  border-top-width: var(--va-border-width);
  border-right-width: var(--va-border-width);
  border-bottom-width: var(--va-border-width);
  border-left-width: var(--va-border-width);
  border-top-style: solid;
  border-right-style: solid;
  border-bottom-style: solid;
  border-left-style: solid;
  border-top-color: var(--va-color-border);
  border-right-color: var(--va-color-border);
  border-bottom-color: var(--va-color-border);
  border-left-color: var(--va-color-border);
  border-top-left-radius: var(--va-radius-sm);
  border-top-right-radius: var(--va-radius-sm);
  border-bottom-right-radius: var(--va-radius-sm);
  border-bottom-left-radius: var(--va-radius-sm);
  background-color: var(--va-color-bg);
}
.va-toggle--on { background-color: var(--va-color-accent); border-top-color: var(--va-color-accent); }

.va-chip {
  font-family: var(--va-font-family);
  font-size: var(--va-font-size-sm);
  line-height: var(--va-line-height);
  color: var(--va-color-muted);
  padding-top: var(--va-space-1);
  padding-bottom: var(--va-space-1);
  padding-left: var(--va-space-2);
  padding-right: var(--va-space-2);
  border-top-left-radius: var(--va-radius-sm);
  border-top-right-radius: var(--va-radius-sm);
  border-bottom-right-radius: var(--va-radius-sm);
  border-bottom-left-radius: var(--va-radius-sm);
  background-color: var(--va-color-bg);
}
.va-chip--selected { color: var(--va-color-accent); background-color: var(--va-color-surface); }

.va-card {
  background-color: var(--va-color-bg);
  border-top-width: var(--va-border-width);
  border-right-width: var(--va-border-width);
  border-bottom-width: var(--va-border-width);
  border-left-width: var(--va-border-width);
  border-top-style: solid;
  border-right-style: solid;
  border-bottom-style: solid;
  border-left-style: solid;
  border-top-color: var(--va-color-border);
  border-right-color: var(--va-color-border);
  border-bottom-color: var(--va-color-border);
  border-left-color: var(--va-color-border);
  border-top-left-radius: var(--va-radius-md);
  border-top-right-radius: var(--va-radius-md);
  border-bottom-right-radius: var(--va-radius-md);
  border-bottom-left-radius: var(--va-radius-md);
  padding-top: var(--va-space-4);
  padding-bottom: var(--va-space-4);
  padding-left: var(--va-space-4);
  padding-right: var(--va-space-4);
}

.va-row {
  padding-top: var(--va-space-3);
  padding-bottom: var(--va-space-3);
  border-bottom-width: var(--va-border-width);
  border-bottom-style: solid;
  border-bottom-color: var(--va-color-border);
}
`;

/**
 * Edits *inside* a design-system component, as opposed to edits to the tokens
 * it consumes.
 *
 * The distinction is the whole point of having both layers in this example. A
 * token edit is a foundation change with wide, shallow collateral; a component
 * edit is narrow and deep, reaching only the subjects that render that
 * component. A tool that reports them identically has told you nothing about
 * which one you are looking at.
 */
export const DS_OVERRIDES: Readonly<Record<string, string>> = {
  'button-padding': '.va-button { padding-left: var(--va-space-6); padding-right: var(--va-space-6); }',
  'button-weight': '.va-button { font-weight: var(--va-font-weight-strong); }',
};
