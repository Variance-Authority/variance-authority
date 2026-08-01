/**
 * The token foundation.
 *
 * Deliberately small and deliberately strict: **every** design-system rule below
 * consumes these and nothing else. No component sheet contains a literal colour,
 * length, or font stack.
 *
 * That discipline is what makes attribution work at all. A custom property
 * resolves a *name* alongside a value, so a change to `--va-space-3` arrives at
 * the differ already labelled and collapses into one docket root with counted
 * collateral. A component sheet with `padding: 12px` written directly produces
 * the same pixels and no name, so the same edit arrives as N independent
 * findings that nothing can group.
 *
 * This is the property a real design system either has or does not, and it is
 * the single biggest determinant of whether this tool can say anything useful
 * about a repository.
 */

export const TOKENS_CSS = `
:root {
  --va-color-bg: #ffffff;
  --va-color-surface: #fbfbfc;
  --va-color-text: #17181c;
  --va-color-muted: #767a85;
  --va-color-accent: #2d6cdf;
  --va-color-danger: #cf3b3b;
  --va-color-border: #e3e5ea;
  --va-color-done: #a4a8b3;

  --va-space-1: 4px;
  --va-space-2: 8px;
  --va-space-3: 12px;
  --va-space-4: 16px;
  --va-space-6: 24px;

  --va-font-family: ui-sans-serif, system-ui, sans-serif;
  --va-font-size-sm: 13px;
  --va-font-size-md: 15px;
  --va-font-size-lg: 22px;
  --va-line-height: 1.5;
  --va-font-weight-strong: 600;

  --va-radius-sm: 3px;
  --va-radius-md: 6px;
  --va-border-width: 1px;
}
`;

/**
 * Changes to the foundation, as a real project would ship them: a rule in a
 * theme file, not an inline style.
 *
 * Delivered this way on purpose. An inline override on the subject root is the
 * convenient fixture, and journal 0008 records what convenience cost last
 * time — it routed around a hole where `:root` tokens reached no subject at all,
 * and the corpus scored 37/37 without noticing. These land where a designer
 * would put them.
 */
export const TOKEN_OVERRIDES: Readonly<Record<string, string>> = {
  'token-radius': ':root { --va-radius-md: 14px; --va-radius-sm: 8px; }',
  'token-space': ':root { --va-space-3: 20px; }',
  'token-accent': ':root { --va-color-accent: #b5179e; }',
  'token-type-scale': ':root { --va-font-size-md: 17px; }',
};
