package dev.varianceauthority.jvm.junit;

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
import java.util.UUID;
import java.util.concurrent.ForkJoinPool;

import org.junit.platform.engine.TestExecutionResult;
import org.junit.platform.engine.support.descriptor.ClassSource;
import org.junit.platform.launcher.TestExecutionListener;
import org.junit.platform.launcher.TestIdentifier;
import org.junit.platform.launcher.TestPlan;

/**
 * Splits a recording at every top-level test class.
 *
 * Under JaCoCo, the agent runs with output=none; this listener resets before a class starts and dumps when it finishes, so each
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
 * Presence rows are appended in the analyzer's format to this JVM's own record,
 * `records/<pid>-<uuid>.jsonl`, so forks that share `va.out` never write one file,
 * and a between row is named for its JVM. The presence agent sets `va.out` to
 * its suite's directory when the caller named none. When the plan finishes the
 * agent seals that record and merges every finished one into `record.jsonl` and
 * sense's snapshot; JaCoCo
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
  private Method row;
  private Path own;
  private String between = "between-";
  private int windows;
  private String open;
  private Set<Thread> before = new HashSet<>();

  @Override
  public void testPlanExecutionStarted(TestPlan testPlan) {
    plan = testPlan;
    try {
      Class<?> presence = Class.forName("dev.varianceauthority.jvm.rt.Presence", true, null);
      row = presence.getMethod("row", String.class);
    } catch (ClassNotFoundException | NoSuchMethodException e) {
      row = null;
    }
    try {
      Files.createDirectories(out);
      if (row != null) {
        String jvm = pid() + "-" + UUID.randomUUID();
        own = Files.createDirectories(out.resolve("records")).resolve(jvm + ".jsonl");
        between = "between-" + jvm + "-";
        log("plan-start\t" + System.nanoTime());
        dump(between + windows++);
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
    dump(between + windows++);
  }

  @Override
  public void executionStarted(TestIdentifier id) {
    String name = topLevelClass(id);
    if (name == null) return;
    if (open != null) log("overlap\t" + open + "\t" + name);
    dump(between + windows++);
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
    dump(between + windows++);
    if (row != null) coverage();
    log("plan-end\t" + System.nanoTime());
  }

  /** This JVM's record sealed, and every finished one merged into `record.jsonl` and `coverage.va`, by the presence agent's jar. */
  private void coverage() {
    try {
      Class.forName("dev.varianceauthority.jvm.Coverage", true, ClassLoader.getSystemClassLoader())
          .getMethod("finish", Path.class, Path.class)
          .invoke(null, own, out);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException("presence agent could not write coverage.va", e);
    }
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
    if (row != null) return;
    try {
      setSessionId.invoke(agent, name);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    }
  }

  private void dump(String name) {
    if (row != null) {
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

  /** One analyzer-format row, formatted by the presence store: the methods whose flag was set in this window. */
  private void presence(String name) {
    try {
      String line = (String) row.invoke(null, name);
      Files.write(own, line.getBytes(StandardCharsets.UTF_8),
          StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static String pid() {
    String name = java.lang.management.ManagementFactory.getRuntimeMXBean().getName();
    int at = name.indexOf('@');
    return at < 0 ? name : name.substring(0, at);
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
