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
 * {@code build.sh} runs it against the IDE's own jars before it packs the plugin; it exits
 * non-zero on the first reading that differs.
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
    for (Record.Mark mark : answer.marks()) marks.add(placed(mark));
    same("the one mark the CLI read each run of lines as, across every suite that ran it", marks, List.of(
        "unit+integration 1-4 walked", "unit 6-8 alone", "unit 10-12 hole", "integration 14-15 unwalked"));

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
    for (Record.Mark mark : Record.read(one).marks()) unnamed.add(placed(mark));
    same("a repository that declares no suites paints its ranges", unnamed, List.of("- 1-4 unwalked"));
    JsonObject stale = JsonParser.parseString(
        "{\"file\":\"src/sum.ts\",\"frame\":\"stale\",\"from\":\"coverage.bin\"}").getAsJsonObject();
    same("a stale record, which places no range, paints nothing", Record.read(stale).marks().size(), 0);
    same("a stale record reads as stale", Record.read(stale).stale(), true);

    System.out.println("RecordCheck: the plugin reads the fixtures as the VS Code client does");
  }

  private static String placed(Record.Mark mark) {
    String suites = mark.suites().isEmpty() ? "-" : String.join("+", mark.suites());
    return suites + " " + mark.startLine() + "-" + mark.endLine() + " " + mark.state();
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
