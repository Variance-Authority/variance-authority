import type { Diagnostic, SemanticSnapshot } from '@variance-authority/core/format';

/**
 * Whether the page that was photographed is the page that was acquired.
 *
 * Every region coordinate in an observation is converted from device pixels in the
 * *image* into CSS pixels in the *snapshot*, using a scale and an origin. That
 * conversion is only meaningful if the two describe one layout — and nothing
 * checked. Measured on `cases/storybook-case`: the acquired subject is 147.33 CSS
 * pixels wide and the image painted is 1024 device pixels at scale 1. The
 * baseline is a photograph of a layout that exists in no browser, and every
 * region coordinate below was converted through a width the image does not have.
 *
 * It still attributed correctly there, which is exactly why this is worth a
 * field: the failure is silent, it produces a complete and confident report, and
 * the first layout it will get wrong is any subject that is centred or
 * shrink-to-fit — where the horizontal offset the two spaces disagree by is not
 * zero.
 *
 * `warn`, never `error`. `exit.ts` states the rule: a gate that is red on every
 * run of a correctly configured suite is a gate that gets switched off, and this
 * fires on eight of eight subjects of the flagship case until the acquisition is
 * fixed. It is an alarm to act on, not a verdict about anybody's components.
 */
export function frameDiagnostics(
  snapshot: SemanticSnapshot | undefined,
  after: { readonly width: number; readonly height: number; readonly identity: { readonly deviceScaleFactor: number } },
): readonly Diagnostic[] {
  const rect = snapshot?.root.rect;
  if (rect === undefined) return [];

  const scale = after.identity.deviceScaleFactor;
  const painted = { width: after.width / scale, height: after.height / scale };

  // Half a CSS pixel. Sub-pixel disagreement is rounding between a
  // `getBoundingClientRect` and an integer raster; a whole pixel is a layout.
  const wide = Math.abs(painted.width - rect.width) > 0.5;
  const tall = Math.abs(painted.height - rect.height) > 0.5;
  if (!wide && !tall) return [];

  return [
    {
      severity: 'warn',
      code: 'subject-size-diverged',
      message:
        `the acquired subject is ${rect.width}×${rect.height} CSS pixels and the image painted ` +
        `is ${painted.width}×${painted.height}; the two are not the same layout, so every ` +
        'region coordinate in this observation was converted through a size the image does ' +
        'not have. Attribution may name a neighbouring component and will not say so',
    },
  ];
}
