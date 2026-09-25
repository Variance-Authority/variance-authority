package va.phase0;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.Position;
import com.github.javaparser.Range;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.expr.BinaryExpr;
import com.github.javaparser.ast.expr.BooleanLiteralExpr;
import com.github.javaparser.ast.expr.ConditionalExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.IntegerLiteralExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.stmt.DoStmt;
import com.github.javaparser.ast.stmt.ExpressionStmt;
import com.github.javaparser.ast.stmt.IfStmt;
import com.github.javaparser.ast.stmt.WhileStmt;

/**
 * Two readings of Java source for the Phase 0 harness, both by the parser, never by pattern.
 *
 * <pre>
 * members &lt;source root&gt; &lt;out.json&gt;
 *     {"path": [[first, last], ...]} — the line span of every method and constructor.
 *     A change outside every span is a change to the class's shape (a member added or
 *     removed, a field, an initializer, the hierarchy), which dispatch can observe from
 *     any method of the class.
 *
 * mutate &lt;file&gt; &lt;rel path&gt; &lt;lines csv&gt; &lt;max&gt; &lt;out dir&gt; &lt;first index&gt;
 *     Seeds up to max single-point faults on the given lines: a negated condition, a
 *     swapped operator, a bumped literal, a removed call. Each lands as
 *     out/m&lt;k&gt;/{desc.txt, file.txt (the rel path), src.java (the mutated file)}.
 * </pre>
 */
public final class JavaTools {
  public static void main(String[] args) throws IOException {
    switch (args[0]) {
      case "members": members(Paths.get(args[1]), Paths.get(args[2])); break;
      case "mutate": mutate(Paths.get(args[1]), args[2], args[3], Integer.parseInt(args[4]), Paths.get(args[5]), Integer.parseInt(args[6])); break;
      default: throw new IllegalArgumentException(args[0]);
    }
  }

  private static CompilationUnit parse(String text) {
    ParserConfiguration config = new ParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21);
    ParseResult<CompilationUnit> r = new JavaParser(config).parse(text);
    if (!r.getResult().isPresent()) throw new IllegalStateException(r.getProblems().toString());
    return r.getResult().get();
  }

  private static void members(Path root, Path out) throws IOException {
    StringBuilder json = new StringBuilder("{");
    List<Path> files;
    try (Stream<Path> s = Files.walk(root)) {
      files = s.filter(p -> p.toString().endsWith(".java")).sorted().collect(Collectors.toList());
    }
    boolean firstFile = true;
    for (Path f : files) {
      CompilationUnit cu = parse(new String(Files.readAllBytes(f), StandardCharsets.UTF_8));
      List<String> spans = new ArrayList<>();
      for (CallableDeclaration<?> c : cu.findAll(CallableDeclaration.class)) {
        c.getRange().ifPresent(r -> spans.add("[" + r.begin.line + "," + r.end.line + "]"));
      }
      if (!firstFile) json.append(',');
      firstFile = false;
      json.append(quote(root.relativize(f).toString())).append(":[").append(String.join(",", spans)).append(']');
    }
    Files.write(out, json.append('}').toString().getBytes(StandardCharsets.UTF_8));
  }

  /** One candidate fault: replace the text in [from, to) with the replacement. */
  private static final class Site {
    final int from, to, line;
    final String with, desc;
    Site(int from, int to, int line, String with, String desc) {
      this.from = from; this.to = to; this.line = line; this.with = with; this.desc = desc;
    }
  }

  private static void mutate(Path file, String rel, String linesCsv, int max, Path outDir, int firstIndex) throws IOException {
    String text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
    Set<Integer> lines = new HashSet<>();
    for (String l : linesCsv.split(",")) if (!l.isEmpty()) lines.add(Integer.parseInt(l));
    int[] lineStart = lineStarts(text);
    CompilationUnit cu = parse(text);
    List<Site> sites = new ArrayList<>();
    for (Node n : cu.findAll(Node.class)) {
      if (!n.getRange().isPresent() || !lines.contains(n.getRange().get().begin.line)) continue;
      Expression cond = null;
      if (n instanceof IfStmt) cond = ((IfStmt) n).getCondition();
      else if (n instanceof WhileStmt) cond = ((WhileStmt) n).getCondition();
      else if (n instanceof DoStmt) cond = ((DoStmt) n).getCondition();
      else if (n instanceof ConditionalExpr) cond = ((ConditionalExpr) n).getCondition();
      if (cond != null && cond.getRange().isPresent()) {
        Range r = cond.getRange().get();
        String src = slice(text, lineStart, r);
        sites.add(new Site(offset(lineStart, r.begin), offset(lineStart, r.end) + 1, r.begin.line, "!(" + src + ")", "negate condition " + src));
      }
      if (n instanceof BinaryExpr) {
        BinaryExpr b = (BinaryExpr) n;
        String swapped = swap(b.getOperator());
        if (swapped != null && b.getLeft().getRange().isPresent() && b.getRight().getRange().isPresent()) {
          int from = offset(lineStart, b.getLeft().getRange().get().end) + 1;
          int to = offset(lineStart, b.getRight().getRange().get().begin);
          sites.add(new Site(from, to, n.getRange().get().begin.line, " " + swapped + " ", "swap " + b.getOperator().asString() + " to " + swapped));
        }
      }
      if (n instanceof BooleanLiteralExpr) {
        Range r = n.getRange().get();
        boolean v = ((BooleanLiteralExpr) n).getValue();
        sites.add(new Site(offset(lineStart, r.begin), offset(lineStart, r.end) + 1, r.begin.line, String.valueOf(!v), "flip " + v));
      }
      if (n instanceof IntegerLiteralExpr) {
        String v = ((IntegerLiteralExpr) n).getValue();
        if (v.matches("[0-9]+")) {
          Range r = n.getRange().get();
          sites.add(new Site(offset(lineStart, r.begin), offset(lineStart, r.end) + 1, r.begin.line, String.valueOf(Long.parseLong(v) + 1), "bump " + v));
        }
      }
      if (n instanceof ExpressionStmt && ((ExpressionStmt) n).getExpression() instanceof MethodCallExpr) {
        Range r = n.getRange().get();
        sites.add(new Site(offset(lineStart, r.begin), offset(lineStart, r.end) + 1, r.begin.line, ";", "remove call " + ((MethodCallExpr) ((ExpressionStmt) n).getExpression()).getNameAsString()));
      }
    }
    sites.sort(Comparator.comparingInt((Site s) -> s.from).thenComparing(s -> s.desc));
    // Spread the picks over the changed lines rather than taking the first few.
    List<Site> picked = new ArrayList<>();
    if (sites.size() <= max) picked.addAll(sites);
    else for (int i = 0; i < max; i++) picked.add(sites.get(i * sites.size() / max));
    int k = firstIndex;
    for (Site s : picked) {
      Path dir = outDir.resolve("m" + k++);
      Files.createDirectories(dir);
      String mutated = text.substring(0, s.from) + s.with + text.substring(s.to);
      Files.write(dir.resolve("src.java"), mutated.getBytes(StandardCharsets.UTF_8));
      Files.write(dir.resolve("file.txt"), rel.getBytes(StandardCharsets.UTF_8));
      Files.write(dir.resolve("desc.txt"), (rel + ":" + s.line + " " + s.desc).getBytes(StandardCharsets.UTF_8));
    }
    System.out.println(rel + " sites=" + sites.size() + " picked=" + picked.size());
  }

  private static String swap(BinaryExpr.Operator op) {
    switch (op) {
      case EQUALS: return "!=";
      case NOT_EQUALS: return "==";
      case LESS: return ">=";
      case GREATER_EQUALS: return "<";
      case GREATER: return "<=";
      case LESS_EQUALS: return ">";
      case AND: return "||";
      case OR: return "&&";
      case PLUS: return "-";
      case MINUS: return "+";
      case MULTIPLY: return "/";
      default: return null;
    }
  }

  private static int[] lineStarts(String text) {
    List<Integer> starts = new ArrayList<>();
    starts.add(0);
    for (int i = 0; i < text.length(); i++) if (text.charAt(i) == '\n') starts.add(i + 1);
    return starts.stream().mapToInt(Integer::intValue).toArray();
  }

  /** JavaParser columns are 1-based and count a tab as one character. */
  private static int offset(int[] lineStart, Position p) {
    return lineStart[p.line - 1] + p.column - 1;
  }

  private static String slice(String text, int[] lineStart, Range r) {
    return text.substring(offset(lineStart, r.begin), offset(lineStart, r.end) + 1);
  }

  private static String quote(String s) {
    return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }
}
