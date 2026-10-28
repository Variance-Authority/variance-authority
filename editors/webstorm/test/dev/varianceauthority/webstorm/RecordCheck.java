package dev.varianceauthority.webstorm;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * The plugin's reading of {@code variance covering --format json}, on the fixtures the
 * VS Code client's test reads too ({@code packages/editors/src/record.test.ts}).
 * {@code check.sh} runs it against the IDE's own jars; it exits non-zero on the first
 * reading that differs.
 */
final class RecordCheck {
  private RecordCheck() {}

  public static void main(String[] arguments) throws Exception {
    Path fixtures = Path.of(arguments[0]);
    Record.Answer answer = Record.read(json(fixtures.resolve("covering-suites.json")));

    List<String> suites = new ArrayList<>();
    for (Record.Suite suite : answer.suites()) suites.add(suite.name() + " " + suite.kind() + " " + suite.refused());
    same("every suite, in the order the CLI answered", suites, List.of(
        "unit unit null", "integration integration null", "chromium e2e unloaded", "site e2e unrecorded",
        "visual visual null"));

    List<String> marks = new ArrayList<>();
    for (Record.Mark mark : Record.marks(answer)) {
      marks.add(mark.suite().name() + " " + mark.startLine() + "-" + mark.endLine() + " " + mark.range().state());
    }
    same("a line a nearer suite painted is not painted again, a stale suite paints nothing", marks, List.of(
        "unit 1-4 walked", "unit 6-8 alone", "unit 10-12 hole", "integration 14-15 unwalked"));

    Record.Line line = Record.readLine(json(fixtures.resolve("covering-line-suites.json")));
    List<String> lines = new ArrayList<>();
    for (Record.SuiteLine suite : line.suites()) {
      lines.add(suite.name() + " " + suite.state() + " " + suite.files().size() + " files " + suite.cases().size()
          + " cases " + suite.reason());
    }
    same("a line asked of every suite", lines, List.of(
        "unit walked 1 files 2 cases null",
        "integration loaded 0 files 0 cases null",
        "chromium null 0 files 0 cases " + line.suites().get(2).reason()));
    if (line.suites().get(2).reason() == null) fail("a refused suite carries its reason");

    JsonObject one = JsonParser.parseString(
        "{\"file\":\"src/sum.ts\",\"frame\":\"mapped\",\"ranges\":[{\"startLine\":1,\"endLine\":4,\"tests\":[],\"state\":\"unwalked\"}]}")
        .getAsJsonObject();
    List<String> unnamed = new ArrayList<>();
    for (Record.Mark mark : Record.marks(Record.read(one))) {
      unnamed.add(mark.suite().name() + " " + mark.startLine() + "-" + mark.endLine() + " " + mark.range().state());
    }
    same("a repository that declares no suites reads as one suite without a name", unnamed,
        List.of("null 1-4 unwalked"));
    one.addProperty("frame", "stale");
    same("a stale record paints nothing", Record.marks(Record.read(one)).size(), 0);

    System.out.println("RecordCheck: the plugin reads the fixtures as the VS Code client does");
  }

  private static JsonObject json(Path path) throws Exception {
    return JsonParser.parseString(Files.readString(path)).getAsJsonObject();
  }

  private static void same(String what, Object actual, Object expected) {
    if (!actual.equals(expected)) fail(what + "\n  expected " + expected + "\n  read     " + actual);
  }

  private static void fail(String message) {
    System.err.println("RecordCheck: " + message);
    System.exit(1);
  }
}
