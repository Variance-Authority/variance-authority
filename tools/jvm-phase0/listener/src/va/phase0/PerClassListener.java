package va.phase0;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ForkJoinPool;

import org.junit.platform.engine.TestExecutionResult;
import org.junit.platform.engine.support.descriptor.ClassSource;
import org.junit.platform.launcher.TestExecutionListener;
import org.junit.platform.launcher.TestIdentifier;
import org.junit.platform.launcher.TestPlan;

/**
 * Splits the JaCoCo agent's execution data at every top-level test class.
 *
 * Phase 0 harness, not product code. The agent runs with output=none; this
 * listener resets before a class starts and dumps when it finishes, so each
 * `<class>.exec` holds exactly the probes hit while that class ran. Whatever
 * is hit outside a class (discovery, between classes, after the last) lands
 * in numbered `between-*.exec` files, so spill is counted rather than lost.
 *
 * A dump credits a probe to whichever window it lands in. The listener runs on
 * the thread that runs the class, so that thread's hits cannot leave the window;
 * only other threads can. At each class end it logs every thread the class
 * started that is still alive, and a common pool that is not quiescent. Neither
 * line in a run means no class's work could land in another's window.
 *
 * The store is the presence agent's when it is loaded, and JaCoCo's otherwise.
 * Presence rows are appended to `record.jsonl` in the analyzer's format; JaCoCo
 * windows are written as `<class>.exec` for the analyzer. Either is reached by
 * reflection: presence through the bootstrap loader, JaCoCo through the system
 * class loader, which is also the check that an agent jar is visible to a
 * test's listeners.
 */
public final class PerClassListener implements TestExecutionListener {
  private final Path out = Paths.get(System.getProperty("va.out", "va-exec"));
  private TestPlan plan;
  private Object agent;
  private Method getExecutionData;
  private Method setSessionId;
  private Method drain;
  private Method meta;
  private Method failed;
  private int between;
  private String open;
  private Set<Thread> before = new HashSet<>();

  @Override
  public void testPlanExecutionStarted(TestPlan testPlan) {
    plan = testPlan;
    try {
      Class<?> presence = Class.forName("va.presence.rt.Presence", true, null);
      drain = presence.getMethod("drain");
      meta = presence.getMethod("meta", int.class);
      failed = presence.getMethod("failed");
    } catch (ClassNotFoundException | NoSuchMethodException e) {
      drain = null;
    }
    try {
      Files.createDirectories(out);
      if (drain != null) {
        log("plan-start\t" + System.nanoTime());
        dump("between-" + between++);
        return;
      }
      Class<?> rt = Class.forName("org.jacoco.agent.rt.RT", true, ClassLoader.getSystemClassLoader());
      agent = rt.getMethod("getAgent").invoke(null);
      Class<?> iagent = Class.forName("org.jacoco.agent.rt.IAgent", true, ClassLoader.getSystemClassLoader());
      getExecutionData = iagent.getMethod("getExecutionData", boolean.class);
      setSessionId = iagent.getMethod("setSessionId", String.class);
      log("plan-start\t" + System.nanoTime());
    } catch (ReflectiveOperationException | IOException e) {
      throw new IllegalStateException("JaCoCo agent not reachable from the test class loader", e);
    }
    dump("between-" + between++);
  }

  @Override
  public void executionStarted(TestIdentifier id) {
    String name = topLevelClass(id);
    if (name == null) return;
    if (open != null) log("overlap\t" + open + "\t" + name);
    dump("between-" + between++);
    session(name);
    open = name;
    before = new HashSet<>(Thread.getAllStackTraces().keySet());
    log("start\t" + name + "\t" + System.nanoTime());
  }

  @Override
  public void executionFinished(TestIdentifier id, TestExecutionResult result) {
    String name = topLevelClass(id);
    if (name == null) return;
    dump(name);
    audit(name);
    session("between");
    open = null;
    log("end\t" + name + "\t" + System.nanoTime() + "\t" + result.getStatus());
  }

  @Override
  public void testPlanExecutionFinished(TestPlan testPlan) {
    dump("between-" + between++);
    log("plan-end\t" + System.nanoTime());
  }

  /** The class name when this identifier is a class container whose parent is an engine root. */
  private String topLevelClass(TestIdentifier id) {
    if (!id.isContainer()) return null;
    Optional<ClassSource> source = id.getSource().filter(ClassSource.class::isInstance).map(ClassSource.class::cast);
    if (!source.isPresent()) return null;
    Optional<TestIdentifier> parent = plan.getParent(id);
    if (!parent.isPresent() || plan.getParent(parent.get()).isPresent()) return null;
    return source.get().getClassName();
  }

  /** Threads this class started that outlive it, and a busy common pool: work that can land in a later window. */
  private void audit(String name) {
    for (Thread t : Thread.getAllStackTraces().keySet()) {
      if (before.contains(t) || !t.isAlive()) continue;
      StackTraceElement[] stack = t.getStackTrace();
      log("survivor\t" + name + "\t" + t.getName() + "\t" + t.getState() + "\t" + (t.isDaemon() ? "daemon" : "user")
          + "\t" + (stack.length > 0 ? stack[0] : "-"));
    }
    if (!ForkJoinPool.commonPool().isQuiescent()) log("pool-busy\t" + name);
  }

  private void session(String name) {
    if (drain != null) return;
    try {
      setSessionId.invoke(agent, name);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    }
  }

  private void dump(String name) {
    if (drain != null) {
      presence(name);
      return;
    }
    try {
      byte[] data = (byte[]) getExecutionData.invoke(agent, true);
      Files.write(out.resolve(name + ".exec"), data);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /**
   * One analyzer-format row: the methods whose presence flag was set in this window.
   * {@code unknown} names the classes entered whose source file the agent could not
   * resolve, and every class that failed to instrument before the row closed; either
   * makes the row unable to exclude its test.
   */
  private void presence(String name) {
    try {
      int[] hit = (int[]) drain.invoke(null);
      StringBuilder line = new StringBuilder("{\"owner\":\"").append(name).append("\",\"methods\":[");
      StringBuilder unknown = new StringBuilder();
      boolean first = true;
      for (int i = 0; i < hit.length; i++) {
        String m = (String) meta.invoke(null, hit[i]);
        if (m.startsWith("{\"unknown\":")) {
          unknown.append(unknown.length() > 0 ? "," : "").append(m, 11, m.length() - 1);
          continue;
        }
        if (!first) line.append(',');
        first = false;
        line.append(m);
      }
      for (String f : (String[]) failed.invoke(null)) {
        unknown.append(unknown.length() > 0 ? "," : "").append('"').append(f).append('"');
      }
      line.append(']');
      if (unknown.length() > 0) line.append(",\"unknown\":[").append(unknown).append(']');
      line.append("}\n");
      Files.write(out.resolve("record.jsonl"), line.toString().getBytes(StandardCharsets.UTF_8),
          StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private void log(String line) {
    try {
      Files.write(out.resolve("events.tsv"), (line + "\n").getBytes(),
          StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
