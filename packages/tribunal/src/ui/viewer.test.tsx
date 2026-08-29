import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SubjectView } from '../review.js';
import { createReviewClient } from './client.js';
import { RegionOverlay, RegionTable, Viewer, modesFor } from './review.js';

/**
 * The comparison itself, held to what it may and may not claim.
 *
 * Everything here is one question asked of markup: does a reviewer looking at
 * this see what the run measured, or something the surface decided on its own? A
 * box in the wrong place attributes a change to whatever it lands on; a mode
 * whose image was never kept draws a broken frame and reads as a subject that
 * renders to nothing; a magnification that differs between the two layers is a
 * comparison of two different pictures.
 *
 * `renderToStaticMarkup` is the initial render and nothing more, which is the
 * frame that matters: it is what a reviewer sees before they touch anything, and
 * where a default that lies would do its damage.
 */

const CLIENT = createReviewClient({ endpoint: '/api', token: 'unused-in-a-static-render' });

function subject(overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: 'story:card',
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 1530,
    regions: [],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
    ...overrides,
  };
}

describe('the viewer offers only comparisons this build can make', () => {
  it('leads with regions when the build kept a candidate and its boxes', () => {
    const withRegions = subject({
      size: { width: 100, height: 50 },
      regions: [{ x: 0, y: 0, width: 10, height: 10, pixels: 86, component: 'Toggle', cause: true }],
    });

    expect(modesFor(withRegions)[0]).toBe('regions');
  });

  it('offers no wipe when there is no baseline image to wipe against', () => {
    // A mode whose image does not exist renders a broken frame, and a broken
    // frame in a review surface reads as a subject that renders to nothing.
    const newSubject = subject({ verdict: 'new', has: { before: false, after: true, diff: false } });

    expect(modesFor(newSubject)).not.toContain('wipe');
    expect(modesFor(newSubject)).not.toContain('blink');
  });

  it('says so plainly when the run kept nothing to look at', () => {
    const markup = renderToStaticMarkup(
      <Viewer
        client={CLIENT}
        build="ci-1"
        subject={subject({ has: { before: false, after: false, diff: false } })}
      />,
    );

    expect(markup).toContain('kept no images');
  });

  it('says which reading is on screen where the controls are, not over the picture', () => {
    // This sat in the plate's corner, which is not a place: at 4× the plate is
    // five thousand pixels wide and its corner is somewhere off the edge of the
    // pane. A reviewer holding a wipe at 30% has to be able to read 30% without
    // scrolling back to find the label.
    const markup = renderToStaticMarkup(
      <Viewer client={CLIENT} build="7" subject={subject({ size: { width: 100, height: 50 } })} />,
    );

    const bar = markup.indexOf('va-viewer-bar');
    const said = markup.indexOf('va-showing');
    const picture = markup.indexOf('va-loupe');

    expect(bar).toBeGreaterThan(-1);
    expect(said).toBeGreaterThan(bar);
    expect(said).toBeLessThan(picture);
    expect(markup).toContain('▶ this build');
  });

  it('reports regions that were found and not recorded', () => {
    const markup = renderToStaticMarkup(
      <Viewer
        client={CLIENT}
        build="ci-1"
        subject={subject({ truncated: { regions: 12, pixels: 900 } })}
      />,
    );

    // Never silently dropped. A docket that showed five regions when eleven were
    // found is a docket a reviewer would trust as complete.
    expect(markup).toContain('12 further regions');
  });
});

describe('a docket of subjects does not decode every raster to draw a table', () => {
  it('defers the candidate and reserves the box it will need', () => {
    // A route suite's candidates are full-page. Twenty of them decoded at once is
    // tens of thousands of rows of bitmap in one document, and the reviewer is
    // reading a four-row table at the top of it.
    const markup = renderToStaticMarkup(
      <Viewer
        client={CLIENT}
        build="7"
        subject={subject({
          size: { width: 1280, height: 8868 },
          regions: [{ x: 0, y: 0, width: 10, height: 10, pixels: 86, cause: true }],
        })}
      />,
    );

    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('width="1280"');
    expect(markup).toContain('height="8868"');
  });

  it('reserves nothing for a baseline, whose height is frequently the change', () => {
    // `size` is the candidate's. A comparison mode draws both, and giving the
    // baseline the candidate's box settles the page at one height and then jumps
    // — worse than not reserving at all.
    const markup = renderToStaticMarkup(
      <Viewer client={CLIENT} build="7" subject={subject({ size: { width: 8, height: 8 } })} />,
    );
    const tag = (which: string): string =>
      new RegExp(`<img[^>]*alt="[^"]*${which}"[^>]*>`).exec(markup)?.[0] ?? '';

    expect(tag('baseline')).toContain('loading="lazy"');
    expect(tag('baseline')).not.toContain('width=');
    expect(tag('candidate')).toContain('width="8"');
  });
});

describe('region boxes are placed from the raster’s own dimensions', () => {
  it('positions cause and collateral distinctly', () => {
    const markup = renderToStaticMarkup(
      <RegionOverlay
        focus={1}
        subject={subject({
          size: { width: 200, height: 100 },
          regions: [
            { x: 20, y: 10, width: 40, height: 20, pixels: 86, component: 'Toggle', cause: true },
            { x: 0, y: 50, width: 200, height: 50, pixels: 511, component: 'Stack', cause: false },
          ],
        })}
      />,
    );

    expect(markup).toContain('left:10%');
    expect(markup).toContain('va-cause');
    expect(markup).toContain('va-collateral');
    // Cause and collateral must not read as the same finding — which is exactly
    // the mistake ranking by area makes.
    expect(markup).toContain('Stack (collateral)');
  });

  it('names the cause on the picture and leaves the rest to their number', () => {
    // Thirty captions over a page fitted to a pane overlap into a grey field. The
    // ordinal is the number the region is listed under, so the box is still joined
    // to its row; the sentence arrives on hover and in the table.
    const markup = renderToStaticMarkup(
      <RegionOverlay
        subject={subject({
          size: { width: 200, height: 100 },
          regions: [
            { x: 20, y: 10, width: 40, height: 20, pixels: 86, component: 'Toggle', cause: true },
            { x: 0, y: 50, width: 200, height: 50, pixels: 511, component: 'Stack', cause: false },
          ],
        })}
      />,
    );

    expect(markup).toContain('Toggle');
    expect(markup).not.toContain('Stack');
    // Still two boxes: what is quiet is the caption, not the finding.
    expect(markup.match(/class="va-region /g)).toHaveLength(2);
  });

  it('draws nothing when the build did not carry the candidate size', () => {
    const markup = renderToStaticMarkup(
      <RegionOverlay
        subject={subject({
          regions: [{ x: 0, y: 0, width: 1, height: 1, pixels: 1, cause: true }],
        })}
      />,
    );

    // The alternative is guessing a scale, and a box in the wrong place is worse
    // than no box: it attributes a change to whatever it lands on.
    expect(markup).toBe('');
  });
});

describe('the stage is a comparison rather than a picture of one', () => {
  const shifted = subject({
    size: { width: 1280, height: 8868 },
    regions: [
      {
        x: 40,
        y: 6100,
        width: 220,
        height: 48,
        pixels: 86,
        component: 'Button',
        file: 'src/ui/button.tsx:41',
        cause: true,
      },
    ],
  });

  it('draws both readings inside one plate, so neither is at its own scale', () => {
    // The defect this replaced: the candidate opted out of the frame's width and
    // the baseline did not, so the two layers were magnified differently and the
    // wipe compared geometry that does not correspond — a change everywhere the
    // seam happened to fall.
    const markup = renderToStaticMarkup(<Viewer client={CLIENT} build="7" subject={shifted} />);
    const plate = /<div class="va-plate[^"]*"[^>]*>([\s\S]*)<\/div>/.exec(markup)?.[1] ?? '';

    expect(plate.match(/<img/g)).toHaveLength(2);
    expect(markup).not.toContain('va-swipe-top');
  });

  it('draws each reading at its own share when the two are not the same size', () => {
    // The change other tools in this category lose: a page that got wider. Both
    // layers stretched to one box makes an 80-pixel resize into a hairline at the
    // edge, and every mode reads as "identical apart from the margin".
    const resized = renderToStaticMarkup(
      <Viewer
        client={CLIENT}
        build="7"
        subject={subject({
          size: { width: 1280, height: 8868 },
          baseline: { width: 1200, height: 8868 },
          regions: shifted.regions,
        })}
      />,
    );

    // The plate is the union of the two, and the narrower reading takes its own
    // share of it — 1200/1280 — rather than being drawn to the frame.
    expect(resized).toContain('aspect-ratio:1280 / 8868');
    expect(resized).toContain('width:93.75%');
  });

  it('does not resize either reading when both are the size the run measured', () => {
    const same = renderToStaticMarkup(
      <Viewer
        client={CLIENT}
        build="7"
        subject={subject({
          size: { width: 1280, height: 8868 },
          baseline: { width: 1280, height: 8868 },
          regions: shifted.regions,
        })}
      />,
    );

    // No layer opts out of the frame, because neither has to: the stylesheet
    // draws both to the plate and the plate is the size they agree on. The
    // region boxes are percentages too, so this asks the images specifically.
    for (const tag of same.match(/<img[^>]*>/g) ?? []) expect(tag).not.toContain('width:');
    expect(same).toContain('aspect-ratio:1280 / 8868');
  });

  it('says what one to one is, and says when the baseline was another shape', () => {
    // The number the zoom buttons are relative to, which is otherwise something a
    // reviewer infers. And when the two differ, the difference is said in words
    // rather than left to be spotted.
    const grew = renderToStaticMarkup(
      <Viewer
        client={CLIENT}
        build="7"
        subject={subject({
          size: { width: 1280, height: 8868 },
          baseline: { width: 1200, height: 8868 },
        })}
      />,
    );
    const steady = renderToStaticMarkup(
      <Viewer
        client={CLIENT}
        build="7"
        subject={subject({
          size: { width: 1280, height: 8868 },
          baseline: { width: 1280, height: 8868 },
        })}
      />,
    );

    expect(grew).toContain('1,280 × 8,868');
    expect(grew).toContain('was 1,200 × 8,868');
    expect(steady).toContain('1,280 × 8,868');
    expect(steady).not.toContain('was ');
  });

  it('places the boxes in the frame the comparison measured, not the candidate’s', () => {
    // Regions come from the diff, and a diff pads both captures to their union.
    // Scaling them by the candidate's width puts every box short by the
    // difference — and a box in the wrong place attributes a change to whatever
    // it lands on, which is worse than no box at all.
    const markup = renderToStaticMarkup(
      <RegionOverlay
        subject={subject({
          size: { width: 100, height: 100 },
          regions: [{ x: 50, y: 0, width: 10, height: 10, pixels: 4, cause: true }],
        })}
        box={{ width: 200, height: 100 }}
      />,
    );

    expect(markup).toContain('left:25%');
    expect(markup).not.toContain('left:50%');
  });

  it('offers a magnification only where the run measured the candidate', () => {
    // Zoom is drawn from the raster's own width. Without it there is no 1:1 to
    // offer, and a button that claims one would be picking a scale.
    const measured = renderToStaticMarkup(<Viewer client={CLIENT} build="7" subject={shifted} />);
    const unmeasured = renderToStaticMarkup(
      <Viewer client={CLIENT} build="7" subject={subject()} />,
    );

    expect(measured).toContain('va-zooms');
    expect(unmeasured).not.toContain('va-zooms');
  });

  it('fits by shrinking, and refuses to fit by magnifying', () => {
    // A 390-wide mobile capture in a 700-wide pane. The run refuses smoothing, so
    // an upscale adds nothing but blocks the render never had — and it quietly
    // makes `1×` the smaller of the two readings, which is the wrong way round.
    const narrow = renderToStaticMarkup(
      <Viewer
        client={CLIENT}
        build="7"
        subject={subject({ size: { width: 390, height: 8708 }, regions: shifted.regions })}
      />,
    );

    expect(narrow).toContain('max-width:390px');
  });

  it('names its modes rather than printing their identifiers', () => {
    const markup = renderToStaticMarkup(<Viewer client={CLIENT} build="7" subject={shifted} />);

    expect(markup).toContain('side by side');
    expect(markup).not.toContain('>side-by-side<');
  });

  it('keeps the boxes on the same sheet as the pixels they mark', () => {
    // The overlay is positioned as a percentage of the plate. Outside it — beside
    // the stage, or over a raster that took its own width — the same percentages
    // land somewhere else, and a box in the wrong place attributes the change to
    // whatever it lands on.
    const markup = renderToStaticMarkup(<Viewer client={CLIENT} build="7" subject={shifted} />);
    const plate = /<div class="va-plate[^"]*"[^>]*>([\s\S]*)<\/div>/.exec(markup)?.[1] ?? '';

    expect(markup).toContain('va-loupe');
    expect(plate).toContain('va-regions');
    expect(plate).toContain('<img');
  });
});

describe('a region is a row as well as a rectangle', () => {
  it('names the file, which is the column a box cannot draw', () => {
    // A rectangle says *here*. Only the row says which file to open, and that is
    // what lets a reviewer hand the change to whoever owns it.
    const markup = renderToStaticMarkup(
      <RegionTable
        subject={subject({
          size: { width: 200, height: 100 },
          regions: [
            {
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              pixels: 86,
              component: 'Toggle',
              file: 'src/ds/components.tsx:41',
              cause: true,
            },
          ],
        })}
        focus={null}
        onFocus={() => undefined}
        onJump={() => undefined}
      />,
    );

    expect(markup).toContain('src/ds/components.tsx:41');
    expect(markup).toContain('Toggle');
    expect(markup).toContain('cause');
  });

  it('says a region nothing was attributed to was not attributed', () => {
    const markup = renderToStaticMarkup(
      <RegionTable
        subject={subject({
          regions: [{ x: 0, y: 0, width: 1, height: 1, pixels: 1, cause: false }],
        })}
        focus={null}
        onFocus={() => undefined}
        onJump={() => undefined}
      />,
    );

    // Never a blank cell, which reads as a component with an empty name.
    expect(markup).toContain('unattributed');
    expect(markup).toContain('not recorded');
  });
});
