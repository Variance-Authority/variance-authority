// Sending: a post is tried up to three times, and every event is kept.
let next = 61;

function transport(_body) {
  if (globalThis.failures > 0) {
    globalThis.failures -= 1;
    throw new Error('offline');
  }
  next += 1;
  return next;
}

function post(body, user) {
  for (let left = 3; ; left -= 1) {
    try {
      return transport({ ...body, user });
    } catch (error) {
      if (left === 1) throw error;
    }
  }
}

function track(event, user) {
  globalThis.events = [...(globalThis.events ?? []), { event, user }];
}

globalThis.post = post;
globalThis.track = track;
