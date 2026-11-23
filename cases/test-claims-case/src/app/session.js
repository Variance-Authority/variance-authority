// Who is signed in: a guest session is its own user.
function userId() {
  const session = globalThis.session;
  if (session !== undefined && session.kind === 'guest') return 'guest';
  return 'u-42';
}

globalThis.userId = userId;
