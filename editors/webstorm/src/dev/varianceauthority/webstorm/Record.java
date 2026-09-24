package dev.varianceauthority.webstorm;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
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
  record Range(int startLine, int endLine, String state, boolean moved, List<String> cases, List<String> stopped) {}

  /** The answer about one file: its ranges and the frame they stand in, or the CLI's refusal. */
  record Answer(List<Range> ranges, String frame, String refusal) {}

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
    GeneralCommandLine command = new GeneralCommandLine(
        commandFor(root), "covering", "--file", file, "--root", root, "--text", "-", "--format", "json")
        .withWorkDirectory(root)
        .withCharset(StandardCharsets.UTF_8)
        // The shell's environment, so `node` is found the way a terminal finds it.
        .withParentEnvironmentType(GeneralCommandLine.ParentEnvironmentType.CONSOLE);
    try {
      CapturingProcessHandler handler = new CapturingProcessHandler(command);
      try (OutputStream input = handler.getProcessInput()) {
        input.write(text.getBytes(StandardCharsets.UTF_8));
      }
      ProcessOutput output = handler.runProcess(30_000);
      if (output.isTimeout()) return refused("variance did not answer within 30 seconds.");
      if (output.getExitCode() != 0) return refused(firstParagraph(output.getStderr()));
      return read(JsonParser.parseString(output.getStdout()).getAsJsonObject());
    } catch (Exception error) {
      return refused("variance could not be asked: " + error.getMessage());
    }
  }

  private static Answer read(JsonObject answer) {
    List<Range> ranges = new ArrayList<>();
    JsonArray found = answer.has("ranges") ? answer.getAsJsonArray("ranges") : new JsonArray();
    for (JsonElement element : found) {
      JsonObject range = element.getAsJsonObject();
      List<String> cases = new ArrayList<>();
      for (JsonElement test : range.getAsJsonArray("tests")) {
        JsonObject named = test.getAsJsonObject();
        if (named.has("loaded") && named.get("loaded").getAsBoolean()) continue;
        cases.add(named.get("name").getAsString() + " — " + named.get("file").getAsString());
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
    return new Answer(ranges, frame, null);
  }

  private static Answer refused(String sentence) {
    return new Answer(List.of(), null, sentence);
  }

  /** A refusal's first paragraph is the sentence; the rest routes a terminal reader. */
  private static String firstParagraph(String text) {
    String first = text.strip().split("\\n\\s*\\n", 2)[0];
    return first.isEmpty() ? "variance stopped without saying why." : first;
  }
}
