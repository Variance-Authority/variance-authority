package va.presence.rt;

import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.io.File;
import java.util.Map;
import java.util.TreeMap;

/**
 * A request's journey: which execution of which subject the service is answering.
 *
 * Phase 0 harness. The service installs this itself, in the filter or handler it
 * already has, and closes the scope when the request is done:
 *
 * <pre>
 * try (Journey j = Journey.enter(exchange.getRequestHeaders().getFirst("Cookie"),
 *     exchange.getRequestHeaders().getFirst("baggage"))) {
 *   chain.doFilter(exchange);
 * }
 * </pre>
 *
 * The id rides the {@code variance-authority-journey} cookie a driver sets, or the
 * W3C {@code baggage} member of the same name, which any tracing that forwards
 * baggage carries past the first hop. When both arrive and disagree, the request is
 * unattributed. Without the agent, {@link #enter} returns a scope that does nothing,
 * so the call can stay in a build that ships.
 *
 * The store is one flag per method, so a journey is a window of time, not an
 * async context. Every opened or closed scope ends a window, and the methods
 * entered in it are credited to every journey open during it. A window with no
 * journey open, or with a request that carried none, is unattributed and belongs
 * to every subject. Overlapping journeys therefore share their windows: selection
 * widens and misses nothing. Work a request leaves running after its scope closes
 * lands in whichever window it runs in, the one case a window cannot follow.
 *
 * Rows are appended to {@code <va.out>/record.jsonl} as {@code journey:<id>} and
 * {@code between-journey-<n>}; the driver's table of which subject each journey
 * was is joined afterwards, by the agent's {@code Coverage}.
 */
public final class Journey implements AutoCloseable {
  public static final String COOKIE = "variance-authority-journey";
  /** The key of a request that carried no journey, or two that disagree. */
  private static final String NONE = "";
  private static final Journey OFF = new Journey(null);
  private static final Map<String, Integer> OPEN = new TreeMap<>();
  private static int between;

  private final String key;
  private boolean closed;

  private Journey(String key) {
    this.key = key;
  }

  /** Opens a scope for the journey the request carried, in either header; both may be null. */
  public static Journey enter(String cookie, String baggage) {
    if (!Presence.on) return OFF;
    String fromCookie = member(cookie, ';', false);
    String fromBaggage = member(baggage, ',', true);
    String key = fromCookie == null ? fromBaggage
        : fromBaggage == null || fromBaggage.equals(fromCookie) ? fromCookie : null;
    if (key == null) key = NONE;
    synchronized (Journey.class) {
      window();
      Integer depth = OPEN.get(key);
      OPEN.put(key, depth == null ? 1 : depth + 1);
    }
    return new Journey(key);
  }

  /** The journey this scope was opened for; null when none, or when nothing records. */
  public String id() {
    return key == null || key.isEmpty() ? null : key;
  }

  @Override
  public void close() {
    if (key == null) return;
    synchronized (Journey.class) {
      if (closed) return;
      closed = true;
      window();
      int depth = OPEN.get(key) - 1;
      if (depth == 0) OPEN.remove(key);
      else OPEN.put(key, depth);
    }
  }

  /** Ends the current window: its methods go to every journey open during it. */
  private static void window() {
    int[] hit = Presence.drain();
    StringBuilder rows = new StringBuilder();
    if (OPEN.isEmpty() || OPEN.containsKey(NONE)) {
      if (hit.length > 0) rows.append(Presence.row("between-journey-" + between++, hit));
    }
    for (String id : OPEN.keySet()) {
      if (!id.isEmpty()) rows.append(Presence.row("journey:" + id, hit));
    }
    if (rows.length() == 0) return;
    File out = new File(System.getProperty("va.out", "va-exec"));
    out.mkdirs();
    try (OutputStream s = new FileOutputStream(new File(out, "record.jsonl"), true)) {
      s.write(rows.toString().getBytes(StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new UncheckedIOException("presence could not write its journey record", e);
    }
  }

  /** The {@link #COOKIE} member of a cookie or baggage header, or null. */
  static String member(String header, char separator, boolean baggage) {
    if (header == null) return null;
    for (String pair : header.split(String.valueOf(separator))) {
      int eq = pair.indexOf('=');
      if (eq < 0 || !pair.substring(0, eq).trim().equals(COOKIE)) continue;
      String value = pair.substring(eq + 1);
      if (baggage) {
        int props = value.indexOf(';');
        if (props >= 0) value = value.substring(0, props);
        try {
          value = URLDecoder.decode(value.trim(), "UTF-8");
        } catch (IOException e) {
          throw new UncheckedIOException(e);
        }
      }
      value = value.trim();
      return value.isEmpty() ? null : value;
    }
    return null;
  }
}
