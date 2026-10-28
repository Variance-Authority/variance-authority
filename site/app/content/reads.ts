/**
 * Which files an element showed, said on the element.
 *
 * The site is its own install, outside the workspaces, and its build already
 * reads `docs/` and the packages' READMEs from this checkout; it reads the
 * helper the same way, from its source, so the build needs nothing published.
 */
export { reads } from "../../../packages/reads/src/index";
