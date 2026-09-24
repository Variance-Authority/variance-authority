package va.phase0;

import java.io.File;
import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.jacoco.core.analysis.Analyzer;
import org.jacoco.core.analysis.CoverageBuilder;
import org.jacoco.core.analysis.IClassCoverage;
import org.jacoco.core.analysis.ICounter;
import org.jacoco.core.analysis.IMethodCoverage;
import org.jacoco.core.data.ExecutionData;
import org.jacoco.core.tools.ExecFileLoader;

/**
 * Maps every per-class exec file to the methods it entered, one JSON line per exec file.
 *
 * Phase 0 harness. Probes resolve against the class files built at the same
 * commit (JaCoCo matches classes by a CRC64 of their bytes), so this runs right
 * after the recorded suite, before the tree moves.
 *
 * Usage: Analyze <exec dir> <classes dir> <source root relative to repo> <out.jsonl>
 */
public final class Analyze {
  public static void main(String[] args) throws IOException {
    Path execDir = Paths.get(args[0]);
    File classes = new File(args[1]);
    String sourceRoot = args[2];
    List<Path> execs;
    try (Stream<Path> s = Files.list(execDir)) {
      execs = s.filter(p -> p.toString().endsWith(".exec")).sorted().collect(Collectors.toList());
    }
    // Each class file is read once, and each exec analyzes only the classes it
    // executed: a class with no execution data has no covered method to report.
    long started = System.nanoTime();
    Map<String, byte[]> bytes = new HashMap<>();
    try (Stream<Path> s = Files.walk(classes.toPath())) {
      for (Path p : (Iterable<Path>) s.filter(p -> p.toString().endsWith(".class"))::iterator) {
        String rel = classes.toPath().relativize(p).toString().replace(File.separatorChar, '/');
        bytes.put(rel.substring(0, rel.length() - ".class".length()), Files.readAllBytes(p));
      }
    }
    int analyzed = 0;
    try (PrintWriter out = new PrintWriter(Files.newBufferedWriter(Paths.get(args[3]), StandardCharsets.UTF_8))) {
      for (Path exec : execs) {
        ExecFileLoader loader = new ExecFileLoader();
        loader.load(exec.toFile());
        CoverageBuilder builder = new CoverageBuilder();
        Analyzer analyzer = new Analyzer(loader.getExecutionDataStore(), builder);
        for (ExecutionData d : loader.getExecutionDataStore().getContents()) {
          byte[] b = bytes.get(d.getName());
          if (b == null) continue;
          analyzer.analyzeClass(b, d.getName());
          analyzed++;
        }
        String owner = exec.getFileName().toString().replaceAll("\\.exec$", "");
        StringBuilder line = new StringBuilder();
        line.append("{\"owner\":").append(quote(owner))
            .append(",\"recordedClasses\":").append(loader.getExecutionDataStore().getContents().size())
            .append(",\"methods\":[");
        boolean first = true;
        for (IClassCoverage c : builder.getClasses()) {
          if (c.getSourceFileName() == null) continue;
          String file = sourceRoot + "/" + c.getPackageName() + "/" + c.getSourceFileName();
          for (IMethodCoverage m : c.getMethods()) {
            if (m.getMethodCounter().getCoveredCount() == 0) continue;
            if (!first) line.append(',');
            first = false;
            line.append("{\"file\":").append(quote(file))
                .append(",\"class\":").append(quote(c.getName()))
                .append(",\"method\":").append(quote(m.getName() + m.getDesc()))
                .append(",\"first\":").append(m.getFirstLine())
                .append(",\"last\":").append(m.getLastLine())
                .append(",\"lines\":").append(coveredLines(m))
                .append('}');
          }
        }
        line.append("]}");
        out.println(line);
      }
    }
    System.err.printf("analyze: %d execs, %d class files, %d class analyses, %d ms%n",
        execs.size(), bytes.size(), analyzed, (System.nanoTime() - started) / 1_000_000);
  }

  private static String coveredLines(IMethodCoverage m) {
    List<String> lines = new ArrayList<>();
    for (int i = m.getFirstLine(); i <= m.getLastLine() && i > 0; i++) {
      int status = m.getLine(i).getStatus();
      if (status == ICounter.FULLY_COVERED || status == ICounter.PARTLY_COVERED) lines.add(Integer.toString(i));
    }
    return "[" + String.join(",", lines) + "]";
  }

  private static String quote(String s) {
    return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }
}
