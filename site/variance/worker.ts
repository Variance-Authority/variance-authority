/**
 * The Worker a recorded run serves: vinext's own handler, inside the journey
 * the request's cookie names.
 *
 * The scope is held until the response body has been written out, not until
 * the handler returns: a server component renders while its stream is read, and
 * a scope that closed at the first byte would charge that rendering to the next
 * request.
 */

import { collectJourneys } from "@variance-authority/sense/journey";
import handler from "vinext/server/fetch-handler";

const journeys = collectJourneys();

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch(request: Request, env: unknown, context: Context): Promise<Response> {
    let respond!: (response: Response) => void;
    let refuse!: (error: unknown) => void;
    const responded = new Promise<Response>((resolve, reject) => ((respond = resolve), (refuse = reject)));
    const held = journeys.enter(request.headers.get("cookie") ?? undefined, async () => {
      let response: Response;
      try {
        response = await handler.fetch(request, env, context);
      } catch (error) {
        refuse(error);
        return;
      }
      if (response.body === null) {
        respond(response);
        return;
      }
      const { readable, writable } = new TransformStream();
      const piped = response.body.pipeTo(writable);
      respond(new Response(readable, response));
      // A client that stops reading ends the pipe early; the scope still
      // closes here, and what rendered so far is still this journey's.
      await piped.catch(() => undefined);
    });
    context.waitUntil(Promise.resolve(held));
    return responded;
  },
};
