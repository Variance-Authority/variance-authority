package dev.varianceauthority.webstorm;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.execution.ExecutionException;
import com.intellij.execution.configurations.GeneralCommandLine;
import com.intellij.execution.process.CapturingProcessHandler;
import com.intellij.execution.process.ProcessOutput;
import java.io.File;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Ask the record about the text an editor holds.
 *
 * <p>The plugin computes nothing about coverage. The CLI owns the record, the
 * frame and the one state every range is painted as; this class carries the
 * buffer to it on standard input and the answer back. A second reading of the
 * record in here would be a second implementation of the state rule, and two
 * editors could then paint one range differently.
 */
final class Record {
  /** One recorded range where it stands in the held text. */
  record Range(int startLine, int endLine, String state, boolean moved, List<Case> cases, List<String> stopped) {}

  /**
   * One suite's answer about one file: its ranges and the frame they stand in, or why its
   * record could not answer ({@code reason}, and {@code refused} when the CLI names the kind).
   * A repository that declares no suites answers once, as a suite with no {@code name}.
   */
  record Suite(String name, String kind, String frame, List<Range> ranges, String refused, String reason) {}

  /**
   * The answer about one file: every suite's, nearest kind first as the CLI ordered them, or
   * the CLI's refusal. {@code quiet} is a refusal that holds for the whole project until a
   * run changes it: no CLI to ask, or nothing recorded.
   */
  record Answer(List<Suite> suites, String refusal, boolean quiet) {}

  /** The lines of one suite's range that the gutter paints with its state. */
  record Mark(Suite suite, Range range, int startLine, int endLine) {}

  /** One test file among the cases that went through a line: how many of its cases did, of how many. */
  record TestFile(String file, int cases, int of, Integer hops) {}

  /** One case by the file that declares it. */
  record Case(String file, String name) {}

  /** One suite's answer about one line: its test files nearest first, and their cases, or why it has none. */
  record SuiteLine(String name, String kind, String state, List<TestFile> files, List<Case> cases, String reason) {}

  /** The answer about one line: every suite's, or the CLI's refusal. */
  record Line(List<SuiteLine> suites, String refusal) {}

  private Record() {}

  /**
   * The CLI this project installed, or the one on {@code PATH}. The project's
   * own comes first because it reads the recording the project's own suite
   * wrote.
   */
  static String commandFor(String root) {
    File local = new File(root, "node_modules/.bin/variance");
    return local.canExecute() ? local.getPath() : "variance";
  }

  static Answer ask(String root, String file, String text) {
    Asked asked = run(root, text, "covering", "--file", file, "--root", root, "--text", "-", "--format", "json");
    return asked.refusal() != null ? new Answer(List.of(), asked.refusal(), asked.quiet()) : read(asked.answer());
  }

  /**
   * Ask about one line of the held text, with the import hops from the file to
   * each test file. The hops cost the CLI a scan of the tree, so this is asked
   * when somebody clicks, never on an edit.
   */
  static Line askLine(String root, String file, String text, int line) {
    Asked asked = run(root, text, "covering", "--file", file, "--line", Integer.toString(line), "--hops",
        "--root", root, "--text", "-", "--format", "json");
    return asked.refusal() != null ? new Line(List.of(), asked.refusal()) : readLine(asked.answer());
  }

  /** The CLI's answer about one line, suite by suite. */
  static Line readLine(JsonObject answer) {
    List<SuiteLine> suites = new ArrayList<>();
    for (JsonObject suite : suitesOf(answer)) {
      List<TestFile> files = new ArrayList<>();
      if (suite.has("files")) {
        for (JsonElement element : suite.getAsJsonArray("files")) {
          JsonObject row = element.getAsJsonObject();
          files.add(new TestFile(
              row.get("file").getAsString(),
              row.get("cases").getAsInt(),
              row.get("of").getAsInt(),
              row.has("hops") ? row.get("hops").getAsInt() : null));
        }
      }
      suites.add(new SuiteLine(string(suite, "suite"), string(suite, "kind"), string(suite, "state"), files,
          suite.has("tests") ? called(suite.getAsJsonArray("tests")) : List.of(), string(suite, "reason")));
    }
    return new Line(suites, null);
  }

  private record Asked(JsonObject answer, String refusal, boolean quiet) {}

  private static Asked run(String root, String text, String... arguments) {
    List<String> command = new ArrayList<>();
    command.add(commandFor(root));
    command.addAll(List.of(arguments));
    GeneralCommandLine line = new GeneralCommandLine(command)
        .withWorkDirectory(root)
        .withCharset(StandardCharsets.UTF_8)
        // The shell's environment, so `node` is found the way a terminal finds it.
        .withParentEnvironmentType(GeneralCommandLine.ParentEnvironmentType.CONSOLE);
    CapturingProcessHandler handler;
    try {
      handler = new CapturingProcessHandler(line);
    } catch (ExecutionException error) {
      // No CLI to ask: this project does not use variance, or has not installed it yet.
      return new Asked(null, "variance could not be started: " + error.getMessage(), true);
    }
    try {
      try (OutputStream input = handler.getProcessInput()) {
        input.write(text.getBytes(StandardCharsets.UTF_8));
      }
      ProcessOutput output = handler.runProcess(30_000);
      if (output.isTimeout()) return new Asked(null, "variance did not answer within 30 seconds.", false);
      if (output.getExitCode() != 0) {
        return new Asked(null, firstParagraph(output.getStderr()), unrecorded(output.getStdout()));
      }
      return new Asked(JsonParser.parseString(output.getStdout()).getAsJsonObject(), null, false);
    } catch (Exception error) {
      return new Asked(null, "variance could not be asked: " + error.getMessage(), false);
    }
  }

  /** The CLI's answer about one file, suite by suite. */
  static Answer read(JsonObject answer) {
    List<Suite> suites = new ArrayList<>();
    for (JsonObject suite : suitesOf(answer)) {
      suites.add(new Suite(string(suite, "suite"), string(suite, "kind"), string(suite, "frame"), ranges(suite),
          string(suite, "refused"), string(suite, "reason")));
    }
    return new Answer(suites, null, false);
  }

  /**
   * The ranges to paint, one mark per line. A line two suites ran carries the nearer
   * suite's mark, because the CLI answers nearest first; the tooltip names the others.
   * A stale record is placed nowhere, so it paints nothing.
   */
  static List<Mark> marks(Answer answer) {
    Set<Integer> painted = new HashSet<>();
    List<Mark> marks = new ArrayList<>();
    for (Suite suite : answer.suites()) {
      if ("stale".equals(suite.frame())) continue;
      for (Range range : suite.ranges()) {
        Integer start = null;
        for (int line = range.startLine(); line <= range.endLine() + 1; line++) {
          boolean free = line <= range.endLine() && !painted.contains(line);
          if (free && start == null) start = line;
          if (!free && start != null) {
            marks.add(new Mark(suite, range, start, line - 1));
            start = null;
          }
        }
        for (int line = range.startLine(); line <= range.endLine(); line++) painted.add(line);
      }
    }
    return marks;
  }

  /** A repository that declares suites answers under {@code suites}; one that declares none answers once. */
  private static List<JsonObject> suitesOf(JsonObject answer) {
    if (!answer.has("suites")) return List.of(answer);
    List<JsonObject> suites = new ArrayList<>();
    for (JsonElement suite : answer.getAsJsonArray("suites")) suites.add(suite.getAsJsonObject());
    return suites;
  }

  private static String string(JsonObject object, String key) {
    return object.has(key) ? object.get(key).getAsString() : null;
  }

  /** The cases that called into a line, without the ones that only loaded its module. */
  private static List<Case> called(JsonArray tests) {
    List<Case> cases = new ArrayList<>();
    for (JsonElement test : tests) {
      JsonObject named = test.getAsJsonObject();
      if (named.has("loaded") && named.get("loaded").getAsBoolean()) continue;
      cases.add(new Case(named.get("file").getAsString(), named.get("name").getAsString()));
    }
    return cases;
  }

  private static List<Range> ranges(JsonObject suite) {
    List<Range> ranges = new ArrayList<>();
    if (!suite.has("ranges")) return ranges;
    for (JsonElement element : suite.getAsJsonArray("ranges")) {
      JsonObject range = element.getAsJsonObject();
      List<Case> cases = called(range.getAsJsonArray("tests"));
      List<String> stopped = new ArrayList<>();
      if (range.has("stopped")) {
        for (JsonElement test : range.getAsJsonArray("stopped")) {
          JsonObject named = test.getAsJsonObject();
          stopped.add(named.get("name").getAsString() + " — " + named.get("file").getAsString());
        }
      }
      ranges.add(new Range(
          range.get("startLine").getAsInt(),
          range.get("endLine").getAsInt(),
          range.has("state") ? range.get("state").getAsString() : "entered",
          range.has("moved"),
          cases,
          stopped));
    }
    return ranges;
  }

  /** Whether a refusal says the project has nothing recorded, by its kind and never by its words. */
  private static boolean unrecorded(String stdout) {
    try {
      JsonObject refusal = JsonParser.parseString(stdout).getAsJsonObject();
      return refusal.has("refused") && "unrecorded".equals(refusal.get("refused").getAsString());
    } catch (Exception notJson) {
      return false;
    }
  }

  /** A refusal's first paragraph is the sentence; the rest routes a terminal reader. */
  private static String firstParagraph(String text) {
    String first = text.strip().split("\\n\\s*\\n", 2)[0];
    return first.isEmpty() ? "variance stopped without saying why." : first;
  }
}
