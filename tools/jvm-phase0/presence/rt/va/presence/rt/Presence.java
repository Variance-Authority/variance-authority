package va.presence.rt;

import java.util.ArrayList;
import java.util.List;

/**
 * The presence store: one flag per instrumented method, set on entry.
 *
 * Loaded by the bootstrap class loader, so a class in any loader can reach it.
 * The agent assigns each method an index while it transforms the class, before
 * the class can run, and the method's first instructions are
 * {@code Presence.P[index] = true}: one static load and one array store, the
 * same cost as a JaCoCo probe, and one per method rather than one per branch.
 */
public final class Presence {
  /** Fixed size so the reference never changes and the JIT treats it as a constant. */
  public static final boolean[] P = new boolean[Integer.getInteger("va.presence.capacity", 1 << 22)];

  /** Set by the agent's premain: without it nothing is probed and {@link Journey} records nothing. */
  public static volatile boolean on;

  private static final List<String> META = new ArrayList<>();
  private static final List<String> FAILED = new ArrayList<>();

  private Presence() {}

  /** Assigns the next index to a method; {@code meta} is how the listener names it. */
  public static synchronized int register(String meta) {
    if (META.size() == P.length) {
      throw new IllegalStateException("presence capacity " + P.length + " exhausted; raise -Dva.presence.capacity");
    }
    META.add(meta);
    return META.size() - 1;
  }

  /** The indices hit since the last drain, cleared as they are read. */
  public static int[] drain() {
    int n;
    synchronized (Presence.class) {
      n = META.size();
    }
    int[] hit = new int[64];
    int k = 0;
    for (int i = 0; i < n; i++) {
      if (!P[i]) continue;
      P[i] = false;
      if (k == hit.length) hit = java.util.Arrays.copyOf(hit, k * 2);
      hit[k++] = i;
    }
    return java.util.Arrays.copyOf(hit, k);
  }

  /**
   * One record row for {@code owner}: the methods hit since the last drain, cleared
   * as they are read. {@code unknown} names the classes entered whose source file
   * could not be resolved, and every class that failed to instrument so far; either
   * makes the row unable to exclude its owner.
   */
  public static String row(String owner) {
    return row(owner, drain());
  }

  /** The row for methods already drained, which a window credits to several owners. */
  static String row(String owner, int[] hit) {
    StringBuilder line = new StringBuilder("{\"owner\":").append(quote(owner)).append(",\"methods\":[");
    StringBuilder unknown = new StringBuilder();
    boolean first = true;
    for (int i : hit) {
      String m = meta(i);
      if (m.startsWith("{\"unknown\":")) {
        unknown.append(unknown.length() > 0 ? "," : "").append(m, 11, m.length() - 1);
        continue;
      }
      if (!first) line.append(',');
      first = false;
      line.append(m);
    }
    for (String f : failed()) unknown.append(unknown.length() > 0 ? "," : "").append(quote(f));
    line.append(']');
    if (unknown.length() > 0) line.append(",\"unknown\":[").append(unknown).append(']');
    return line.append("}\n").toString();
  }

  static String quote(String s) {
    return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  public static synchronized String meta(int index) {
    return META.get(index);
  }

  /** Records a class the agent meant to instrument and could not: it runs unseen from here on. */
  public static synchronized void fail(String cls) {
    FAILED.add(cls);
  }

  /** Every class that failed so far; no window after its load can say it was not entered. */
  public static synchronized String[] failed() {
    return FAILED.toArray(new String[0]);
  }
}
