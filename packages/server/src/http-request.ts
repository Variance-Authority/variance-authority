import type { IncomingMessage } from 'node:http';
import type { Window } from '@variance-authority/history';
import { BadRequest, MethodNotAllowed, PayloadTooLarge } from './http-errors.js';

/**
 * Everything read off an incoming request before anything is done with it.
 *
 * Method, query parameters, the window they spell, and the body as bytes.
 * Separate from `http.ts` because none of it knows what any route means: these
 * functions either return a checked value or throw one of the refusals, and the
 * routing table stays a list of five paths rather than a list of five paths with
 * their validation inlined.
 */

export function requireMethod(request: IncomingMessage, method: string): void {
  if (request.method === method) return;
  throw new MethodNotAllowed(
    `${request.url ?? ''} is answered over ${method}, not ${request.method ?? 'an unknown method'}`,
    method,
  );
}

export function requiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (value === null || value === '') {
    throw new BadRequest(`\`${name}\` is required on ${url.pathname}`);
  }
  return value;
}

export function optionalParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value === '' ? undefined : value;
}

/**
 * The window, validated before it can quietly select nothing.
 *
 * An unparseable `since` would bind as NULL and match no row, and the answer
 * would be a churn of zero over zero runs — indistinguishable from a component
 * that has never changed. A limit of zero is refused for the same reason: it is a
 * request for an answer computed over nothing, dressed as an answer.
 */
export function windowOf(url: URL): Window {
  const since = optionalParam(url, 'since');
  const until = optionalParam(url, 'until');
  const limit = optionalParam(url, 'limit');

  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    throw new BadRequest(`\`since\` must be an ISO-8601 instant; received "${since}"`);
  }
  if (until !== undefined && Number.isNaN(Date.parse(until))) {
    throw new BadRequest(`\`until\` must be an ISO-8601 instant; received "${until}"`);
  }

  let parsedLimit: number | undefined;
  if (limit !== undefined) {
    parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      throw new BadRequest(
        `\`limit\` must be a whole number of at least 1; received "${limit}". A limit of 0 asks ` +
          'for a drift answer computed over no rows, which reads as stability',
      );
    }
  }

  return {
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
  };
}

/**
 * Read the whole body, or stop and say why.
 *
 * Written with events rather than `for await` because breaking out of an async
 * iteration over a request destroys the stream, and a destroyed request takes the
 * socket with it — the caller would get a connection reset where a 413 explaining
 * itself was the entire point. Here the stream is merely paused; the 413 goes
 * out, and Node closes the connection afterwards because the body was never
 * drained.
 */
export async function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const settle = (act: () => void): void => {
      if (settled) return;
      settled = true;
      act();
    };

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        request.pause();
        settle(() => {
          reject(
            new PayloadTooLarge(
              `the request body exceeds ${maxBodyBytes} bytes and was not read. Nothing was ` +
                'stored: a partially read write would record rows without the run that produced them',
            ),
          );
        });
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => settle(() => resolve(Buffer.concat(chunks).toString('utf8'))));
    request.on('error', (error: Error) => settle(() => reject(error)));
  });
}
