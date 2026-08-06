import {
  CHROMIUM_PROFILE,
  JSDOM_PROFILE,
  type ObservationProfile,
} from '@variance-authority/core';

/**
 * Decide the profile from what the host can actually do.
 *
 * JSDOM reports zeros from `getBoundingClientRect` because it has no layout
 * engine. Probing for that is more honest than sniffing for a JSDOM global: the
 * question the profile answers is "can this host observe geometry", and the way
 * to know is to ask it.
 *
 * Its own module rather than `collect`'s because two callers need it and the
 * other one is `stabilize`, which `collect`'s stylesheet index in turn depends
 * on. One function in the wrong file is all it takes to make three modules a
 * ring instead of a line.
 */
export function detectProfile(view: Window | null): ObservationProfile {
  if (!view) return JSDOM_PROFILE;

  const probe = view.document.createElement('div');
  probe.style.cssText = 'position:absolute;width:100px;height:100px;';
  view.document.body?.appendChild(probe);
  const measured = probe.getBoundingClientRect().width;
  probe.remove();

  return measured > 0 ? CHROMIUM_PROFILE : JSDOM_PROFILE;
}
