/**
 * Every story is drawn on the review page's own ground.
 *
 * The page is one stylesheet, `REVIEW_STYLES`, whose tokens and element reset
 * hang off `.va-app`. A component drawn outside it is a component in the
 * browser's default font on a white page, which no reviewer has ever seen, so a
 * story that photographed that would be a baseline of nothing.
 *
 * A component story sits in a `.va-app` that is as tall as its content rather
 * than as tall as the window, at the width the story asks for — a panel's
 * width is what decides where its text wraps. A page story (`page: true`) is
 * the whole surface and draws its own `.va-app`.
 */
import type { Decorator, Preview } from '@storybook/react-vite';
import { REVIEW_STYLES } from '../src/ui/styles.js';
import { forgetMisses } from '../stories/replay.js';

const ground: Decorator = (Story, context) => {
  const { page, width } = context.parameters as { page?: boolean; width?: number };
  return (
    <>
      <style>{`body { margin: 0; }\n${REVIEW_STYLES}`}</style>
      {page === true ? (
        <Story />
      ) : (
        <div className="va-app" style={{ height: 'auto', overflow: 'visible', padding: 16, width: width ?? 720 }}>
          <Story />
        </div>
      )}
    </>
  );
};

const preview: Preview = {
  decorators: [ground],
  // Each story's misses are its own; `replayed` in its play function reads them.
  beforeEach: forgetMisses,
  parameters: { layout: 'fullscreen' },
};

export default preview;
