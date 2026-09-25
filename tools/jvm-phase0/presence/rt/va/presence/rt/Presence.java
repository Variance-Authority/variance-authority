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
