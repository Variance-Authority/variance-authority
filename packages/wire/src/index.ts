/**
 * `@variance-authority/wire` — how a process under test answers the run that
 * started it.
 *
 * Two instruments talk to a driver during a run. `@variance-authority/event`
 * says what the code decided, so a test can wait for a decision instead of
 * guessing when it was made; `@variance-authority/sense/journey` says which
 * regions of source an execution entered, so the next run can narrow. They are
 * different questions with the same three answers: **one id per execution**,
 * **one address to answer on**, and **nothing written down**. That is this
 * package, and it is the only thing either of them shares.
 *
 * ## One medium, whatever the realm
 *
 * A participant does not know where it is running and must not have to. The
 * page is in the browser; a service is another process; a server a suite starts
 * in-process is neither. So a {@link Channel} resolves its carrier from the
 * realm it finds itself in:
 *
 * 1. A **sink** on `globalThis` ({@link WIRE_SINK}), installed by the driver.
 *    This is the page, and it is also a process the driver started itself: the
 *    report is a function call and there is no hop.
 * 2. A **return address** ({@link RETURN_COOKIE}), which the driver left on a
 *    cookie and the request carried in. This is a service in another process:
 *    the report is a POST to loopback.
 * 3. Neither, which is a request the run did not drive. It reports to nobody,
 *    which is honest and is not an error.
 *
 * The caller writes the same line in all three. Nothing above this file asks
 * which one it got.
 *
 * ## Two guarantees, on purpose
 *
 * {@link Channel.report} is fire-and-forget and {@link Channel.deliver} is
 * acknowledged, because the two instruments fail in opposite directions. A lost
 * announcement is a wait that times out and prints what it did hear — loud, in
 * the driver, where a person is already reading. A lost coverage report is a
 * test **skipped** on the next run: silent, and wrong in the direction that
 * hides a defect. So one of them is allowed to disappear and the other is not.
 */

/**
 * Where a driver installs a carrier in a realm it is inside.
 *
 * `__VA__` is the probe log's root and `__VAE__` is the announcement sink; this is
 * neither. It is how both of those reach a driver once they have something to
 * say, which is why it is one name rather than one per instrument.
 */
export const WIRE_SINK = '__VAW__';

/**
 * The cookie carrying one execution's id.
 *
 * Deliberately not a short name: this shares a namespace with whatever the
 * application already sets, and a collision would surface as a confusing
 * selection rather than as an error.
 */
export const JOURNEY_COOKIE = 'variance-authority-journey';

/**
 * The cookie carrying the address a participant answers on.
 *
 * Beside the id rather than inside it: a head that only announces should not
 * have to parse a coverage key to find its way home, and an id is worth reading
 * even where there is nothing to answer.
 */
export const RETURN_COOKIE = 'variance-authority-return';

/**
 * Which instrument is speaking. The driver routes on this and nothing else.
 *
 * `run` is the one that talks the other way. A run is a participant too when
 * something is watching it: same three answers — one id per execution, one
 * address, nothing written down — with the suite reporting and a watcher
 * listening instead of the other way around.
 */
export type Participant = 'events' | 'journeys' | 'run';

/**
 * What a driver installs in a realm it is inside.
 *
 * Anything thenable it returns is what {@link Channel.deliver} waits on, which
 * is how an exposed page function is acknowledged the same way a POST is.
 */
export type WireCarrier = (
  journey: string | undefined,
  participant: Participant,
  body: unknown,
) => unknown;

/** One execution's way home, however far away home is. */
export interface Channel {
  /** This execution's id, when the request carried one. */
  readonly journey: string | undefined;
  /**
   * The listener this channel reaches. Two channels with the same home reach
   * the same driver, whatever journey each carries, so a participant can tell
   * each driver something once rather than on every request.
   */
  readonly home: string;
  /**
   * Say it and move on.
   *
   * Reports on one channel keep their order, which is the only property of this
   * wire a waiting test rests on: *started* has to arrive before *ended*. Every
   * failure is swallowed — the observer may not break the subject.
   */
  readonly report: (participant: Participant, body: unknown) => void;
  /**
   * Say it and know it landed.
   *
   * Retries, and rejects when it finally cannot. A caller that loses one of
   * these owes the run a sentence, because nothing downstream can tell a report
   * that was never sent from a process that did nothing.
   */
  readonly deliver: (participant: Participant, body: unknown) => Promise<void>;
}

/**
 * The way home a request carried, or nothing.
 *
 * `carried` is the request's `Cookie` header — the one place a participant is
 * guaranteed to have, whatever framework sits above it. A realm with a
 * request-scoped cookie accessor of its own may pass the two values joined the
 * same way, and a realm with no requests at all (a page, an in-process server)
 * passes nothing and is answered by the sink.
 */
export function channelFrom(carried?: string): Channel | undefined {
  const journey = cookieIn(carried, JOURNEY_COOKIE);
  const carrier = (globalThis as Record<string, unknown>)[WIRE_SINK];
  if (typeof carrier === 'function') return through(carrier as WireCarrier, journey);

  const address = addressIn(cookieIn(carried, RETURN_COOKIE));
  return address === undefined ? undefined : over(address, journey);
}

/** A name for each carrier this realm has had installed, so a replaced one is a new home. */
const carriers = new WeakMap<WireCarrier, string>();
let installed = 0;

/** A carrier in this realm: the report is a call, and there is no hop. */
function through(carrier: WireCarrier, journey: string | undefined): Channel {
  let home = carriers.get(carrier);
  if (home === undefined) {
    installed += 1;
    home = `realm:${installed}`;
    carriers.set(carrier, home);
  }
  return {
    journey,
    home,
    report: (participant, body) => {
      try {
        void Promise.resolve(carrier(journey, participant, body)).catch(() => {});
      } catch {
        // The subject may not be broken by whoever is listening to it.
      }
    },
    deliver: async (participant, body) => {
      await carrier(journey, participant, body);
    },
  };
}

/**
 * A channel to an address this process was **given** rather than handed on a
 * cookie.
 *
 * For the reporter that already knows where it is answering: a run told where a
 * watcher is listening has no request to read a return address out of, and
 * resolving one through {@link channelFrom} would prefer whatever sink happens
 * to be installed in this realm — which for a driver is its own desk, and would
 * quietly route the run's own reports back to itself.
 *
 * The address is guarded exactly as a carried one is. It arrives from an
 * environment this process did not necessarily write.
 */
export function channelTo(origin: string, journey: string): Channel | undefined {
  const address = addressIn(origin);
  return address === undefined
    ? undefined
    : over(`${address}/${encodeURIComponent(journey)}`, journey);
}

/** A driver in another process: the report is a POST to the address it left. */
function over(address: string, journey: string | undefined): Channel {
  return {
    journey,
    home: new URL(address).origin,
    report: (participant, body) => {
      const endpoint = `${address}/${participant}`;
      const settled = (sending.get(endpoint) ?? RESOLVED)
        .then(async () => {
          await post(endpoint, body);
        })
        .catch(() => {});
      sending.set(endpoint, settled);
      void settled.then(() => {
        if (sending.get(endpoint) === settled) sending.delete(endpoint);
      });
    },
    deliver: async (participant, body) => {
      const endpoint = `${address}/${participant}`;
      // Three attempts, and the pauses are short because the thing being waited
      // for is a listener on this machine. What actually kills a delivery is a
      // driver that has finished, and no amount of waiting brings one back.
      for (let attempt = 0; ; attempt += 1) {
        try {
          await post(endpoint, body);
          return;
        } catch (error) {
          if (attempt >= 2) throw error;
          await new Promise((settle) => setTimeout(settle, 20 * (attempt + 1)));
        }
      }
    },
  };
}

const RESOLVED = Promise.resolve();

/** One report on its way, behind whatever this endpoint is still sending. */
const sending = new Map<string, Promise<void>>();

async function post(endpoint: string, body: unknown): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${endpoint} answered ${response.status}`);
}

/**
 * The address to answer, out of what the request carried.
 *
 * Loopback only, and `http` only. The value is written by whoever is talking to
 * this process, so the guard is the whole of what keeps an instrument from
 * becoming a way to make it fetch an address somebody else chose.
 */
function addressIn(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:') return undefined;
  if (!LOOPBACK.has(url.hostname)) return undefined;
  return url.href.replace(/\/+$/, '');
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** One cookie, read out of a `Cookie` header. */
function cookieIn(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const pair of header.split(';')) {
    const equals = pair.indexOf('=');
    if (equals < 0) continue;
    if (pair.slice(0, equals).trim() !== name) continue;
    const value = pair.slice(equals + 1).trim();
    return value.length === 0 ? undefined : decodeURIComponent(value);
  }
  return undefined;
}
