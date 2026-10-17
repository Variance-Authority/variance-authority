// The three review flows the outer loop drives, each declared rather than
// discovered: which repository carries it, the one edit its pull request makes,
// and what a consumer of that repository should then see.
//
// Every expectation here is a fact about the example at its pinned release.
// When an example changes what it renders, this file changes with it, in the
// same review.

/** Every comment the composite action posts opens with this marker. */
export const DOCKET_MARKER = '<!-- variance-authority: pr-docket v1 -->';

/** The annotation the action's verdict step writes when the run returns 1. */
export const NEEDS_REVIEW = 'variance found changes that need review';

/** The label `variance-accept.mjs` reads in the examples. */
export const ACCEPT_LABEL = 'variance: accept';

/**
 * A change no subject reaches, for the control pull request: an HTML comment
 * appended to the README, which no route, story or test reads.
 */
export const CONTROL = {
  path: 'README.md',
  append: '\n<!-- outer loop: a change no subject reaches -->\n',
};

export const FLOWS = {
  // Baselines in the Actions cache; a label accepts. The one example that also
  // records its unit tests, so the coverage and selection comments are read
  // here.
  cache: {
    repository: 'Variance-Authority/example-storybook',
    minutes: 20,
    change: { path: 'src/Panel.jsx', from: 'padding: 20,', to: 'padding: 28,' },
    checks: ['variance', 'tests'],
    gate: 'variance',
    docket: ['panel--settings', 'src/Panel.jsx'],
    unit: {
      check: 'tests',
      might: '<!-- example-storybook: unit might -->',
      evidence: '<!-- example-storybook: unit evidence -->',
      file: 'src/Panel.jsx',
      tests: ['src/Panel.test.jsx'],
      untouched: ['src/Button.test.jsx'],
      selected: 'variance-authority: selected 1 of 2',
    },
    accept: 'label',
  },

  // Baselines committed through git-LFS; the label's run commits the accepted
  // images back to the pull request's branch.
  lfs: {
    repository: 'Variance-Authority/example-static-site',
    minutes: 15,
    change: { path: 'site/pricing.html', from: '$12 per seat', to: '$14 per seat' },
    checks: ['variance'],
    gate: 'variance',
    docket: ['pricing'],
    accept: 'commit',
    commit: {
      author: 'github-actions[bot]',
      message: 'chore(variance): regenerate baselines',
      // The layout cli 0.15.0 writes: `baselines/v1-<identity digest>/` and the
      // page without `.html`. `commitProblems` carries the marker for the
      // change that moves it.
      files: [/^baselines\/v1-[0-9a-f]{32}\/pricing\.png$/, /^baselines\/v1-[0-9a-f]{32}\/pricing\.json$/],
    },
    // The accept commit is pushed with the example's VARIANCE_PUSH_TOKEN; a
    // commit pushed with GITHUB_TOKEN starts no workflow, so it gets no check.
    unchecked:
      'Variance-Authority/example-static-site pushes the accept commit with its own ' +
      'VARIANCE_PUSH_TOKEN secret, and a commit pushed with GITHUB_TOKEN starts no workflow. ' +
      'Set VARIANCE_PUSH_TOKEN there to a token with contents: write on that repository',
  },

  // The deployment owns the baselines and the review. An approval there is not
  // scoped to a branch: it replaces the baseline `main` and every branch compare
  // against, so it is a merge, and the outer loop makes none. The flow ends at
  // what a reviewer would open — the build on the deployment, the check red —
  // and declares no accept.
  tribunal: {
    repository: 'Variance-Authority/example-tribunal',
    minutes: 40,
    change: {
      path: 'overlay/stories/ProductCard.stories.jsx',
      from: 'args: { product: products[0] }',
      to: 'args: { product: products[1] }',
    },
    checks: ['variance'],
    gate: 'variance',
    docket: ['product-card--control'],
    endpoint: 'https://tribunal-example.variance-authority.dev',
    subjects: [
      'story:product-card--control',
      'story:product-card--control-dark',
      'story:product-card--sale',
      'story:product-card--sale-dark',
    ],
  },
};
