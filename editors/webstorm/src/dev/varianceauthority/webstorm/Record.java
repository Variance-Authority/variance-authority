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
import java.util.List;

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
   * The answer about one file: its ranges and the frame they stand in, or the CLI's refusal.
   * {@code quiet} is a refusal that holds for the whole project until a run changes it:
   * no CLI to ask, or nothing recorded.
   */
  record Answer(List<Range> ranges, String frame, String refusal, boolean quiet) {}

  /** One test file among the cases that went through a line: how many of its cases did, of how many. */
  record TestFile(String file, int cases, int of, Integer hops) {}

  /** One case by the file that declares it. */
  record Case(String file, String name) {}

  /** The answer about one line: its test files nearest first, and their cases, or the CLI's refusal. */
  record Line(List<TestFile> files, List<Case> cases, String refusal) {}

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
    return asked.refusal() != null ? new Answer(List.of(), null, asked.refusal(), asked.quiet()) : read(asked.answer());
  }

  /**
   * Ask about one line of the held text, with the import hops from the file to
   * each test file. The hops cost the CLI a scan of the tree, so this is asked
   * when somebody clicks, never on an edit.
   */
  static Line askLine(String root, String file, String text, int line) {
    Asked asked = run(root, text, "covering", "--file", file, "--line", Integer.toString(line), "--hops",
        "--root", root, "--text", "-", "--format", "json");
    if (asked.refusal() != null) return new Line(List.of(), List.of(), asked.refusal());
    JsonObject answer = asked.answer();
    List<TestFile> files = new ArrayList<>();
    if (answer.has("files")) {
      for (JsonElement element : answer.getAsJsonArray("files")) {
        JsonObject row = element.getAsJsonObject();
        files.add(new TestFile(
            row.get("file").getAsString(),
            row.get("cases").getAsInt(),
            row.get("of").getAsInt(),
            row.has("hops") ? row.get("hops").getAsInt() : null));
      }
    }
    List<Case> cases = new ArrayList<>();
    if (answer.has("tests")) {
      for (JsonElement element : answer.getAsJsonArray("tests")) {
        JsonObject test = element.getAsJsonObject();
        if (test.has("loaded") && test.get("loaded").getAsBoolean()) continue;
        cases.add(new Case(test.get("file").getAsString(), test.get("name").getAsString()));
      }
    }
    return new Line(files, cases, null);
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

  private static Answer read(JsonObject answer) {
    List<Range> ranges = new ArrayList<>();
    JsonArray found = answer.has("ranges") ? answer.getAsJsonArray("ranges") : new JsonArray();
    for (JsonElement element : found) {
      JsonObject range = element.getAsJsonObject();
      List<Case> cases = new ArrayList<>();
      for (JsonElement test : range.getAsJsonArray("tests")) {
        JsonObject named = test.getAsJsonObject();
        if (named.has("loaded") && named.get("loaded").getAsBoolean()) continue;
        cases.add(new Case(named.get("file").getAsString(), named.get("name").getAsString()));
      }
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
    String frame = answer.has("frame") ? answer.get("frame").getAsString() : null;
    return new Answer(ranges, frame, null, false);
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
