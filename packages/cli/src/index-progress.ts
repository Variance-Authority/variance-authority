// compass: variance-authority.reach.source-index

import { Worker } from 'node:worker_threads';

export function indexProgress(): { update(label: string): void; stop(): Promise<void> } {
  return operationProgress('indexing source and documentation');
}

/** A delayed operation indicator whose clock still runs during synchronous native work. */
export function operationProgress(label: string): { update(label: string): void; stop(): Promise<void> } {
  // Writing the inherited stderr descriptor directly keeps the indicator visible
  // while the parent cannot drain a worker stream or run its own timers.
  const worker = new Worker(`
    Promise.all([import('node:worker_threads'), import('node:fs')]).then(([{ parentPort, workerData }, { writeSync }]) => {
    let shown = false, timer, frame = 0, label = workerData.label;
    const frames = ['|', '/', '-', '\\\\'];
    function show() {
      shown = true;
      const seconds = Math.floor((Date.now() - workerData.started) / 1000);
      const text = 'variance: ' + label + ' (' + seconds + 's elapsed)';
      writeSync(2, workerData.tty ? '\\r\\x1b[2K' + frames[frame++ % frames.length] + ' ' + text : text + '\\n');
      timer = setTimeout(show, workerData.tty ? 100 : 5000);
    }
    timer = setTimeout(show, Math.max(0, 5000 - (Date.now() - workerData.started)));
    parentPort.on('message', (message) => {
      if (message !== 'stop') {
        label = message;
        if (shown) { clearTimeout(timer); show(); }
        return;
      }
      clearTimeout(timer);
      if (shown && workerData.tty) writeSync(2, '\\r\\x1b[2K');
      parentPort.close();
    });
    });
  `, { eval: true, workerData: { label, started: Date.now(), tty: process.stderr.isTTY === true } });
  const stopped = new Promise<void>((resolve) => {
    worker.once('exit', () => resolve());
    // A progress writer must not turn a successful index into a failure when
    // its output pipe has closed. The worker exits and still releases the caller.
    worker.once('error', () => undefined);
  });
  return { update: (label) => worker.postMessage(label), stop: async () => { worker.postMessage('stop'); await stopped; } };
}
