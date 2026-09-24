package va.phase0;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.Optional;

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
 * JaCoCo is reached by reflection through the system class loader, which is
 * also the check that an agent jar is visible to a test's listeners.
 */
public final class PerClassListener implements TestExecutionListener {
  private final Path out = Paths.get(System.getProperty("va.out", "va-exec"));
  private TestPlan plan;
  private Object agent;
  private Method getExecutionData;
  private Method setSessionId;
  private int between;
  private String open;

  @Override
  public void testPlanExecutionStarted(TestPlan testPlan) {
    plan = testPlan;
    try {
      Class<?> rt = Class.forName("org.jacoco.agent.rt.RT", true, ClassLoader.getSystemClassLoader());
      agent = rt.getMethod("getAgent").invoke(null);
      Class<?> iagent = Class.forName("org.jacoco.agent.rt.IAgent", true, ClassLoader.getSystemClassLoader());
      getExecutionData = iagent.getMethod("getExecutionData", boolean.class);
      setSessionId = iagent.getMethod("setSessionId", String.class);
      Files.createDirectories(out);
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
    log("start\t" + name + "\t" + System.nanoTime());
  }

  @Override
  public void executionFinished(TestIdentifier id, TestExecutionResult result) {
    String name = topLevelClass(id);
    if (name == null) return;
    dump(name);
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

  private void session(String name) {
    try {
      setSessionId.invoke(agent, name);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    }
  }

  private void dump(String name) {
    try {
      byte[] data = (byte[]) getExecutionData.invoke(agent, true);
      Files.write(out.resolve(name + ".exec"), data);
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
