// A script the service evaluates on the first request that needs it, inside
// that request's journey, which then calls into it.
function standing(tier) {
  if (tier === 'gold') {
    return 'priority';
  }
  return 'queued';
}
globalThis.__standing_default = standing('gold');
globalThis.__standing = standing;
