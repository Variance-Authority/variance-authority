let wired = false;

export function wire(): void {
  wired = true;
}

export function handle(): string {
  if (!wired) throw new Error('clicked before the handler was wired');
  return 'handled';
}
