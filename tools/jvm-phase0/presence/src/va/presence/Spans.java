package va.presence;

import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.LineMap;
import com.sun.source.tree.MethodTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.TreeScanner;
import com.sun.source.util.Trees;
import java.io.IOException;
import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import javax.tools.JavaCompiler;
import javax.tools.SimpleJavaFileObject;
import javax.tools.ToolProvider;

/**
 * Each method's source span, signature to closing brace, from javac's own parser.
 *
 * A line table starts at a method's first statement and ends at its last, and sense
 * reads a function region's first and last lines as shared with the region around
 * it, as a JS function's are. So a change to a Java method's last statement would
 * charge every test that entered the file. The source span puts those lines inside.
 * With no compiler in the running JDK the list is empty and the line tables stand.
 */
final class Spans {
  static final class Span {
    final String name;
    final int first;
    final int last;

    Span(String name, int first, int last) {
      this.name = name;
      this.first = first;
      this.last = last;
    }
  }

  private Spans() {}

  static List<Span> of(String file, final String text) {
    JavaCompiler javac;
    try {
      javac = ToolProvider.getSystemJavaCompiler();
    } catch (LinkageError e) {
      return Collections.emptyList();
    }
    if (javac == null || !file.endsWith(".java")) return Collections.emptyList();
    SimpleJavaFileObject source = new SimpleJavaFileObject(URI.create("string:///" + file), javax.tools.JavaFileObject.Kind.SOURCE) {
      @Override
      public CharSequence getCharContent(boolean ignoreEncodingErrors) {
        return text;
      }
    };
    final List<Span> spans = new ArrayList<>();
    try {
      JavacTask task = (JavacTask) javac.getTask(null, null, d -> {}, Collections.singletonList("-proc:none"), null,
          Collections.singletonList(source));
      final SourcePositions positions = Trees.instance(task).getSourcePositions();
      for (final CompilationUnitTree unit : task.parse()) {
        final LineMap lines = unit.getLineMap();
        new TreeScanner<Void, Void>() {
          @Override
          public Void visitMethod(MethodTree method, Void p) {
            long start = positions.getStartPosition(unit, method);
            long end = positions.getEndPosition(unit, method);
            if (method.getBody() != null && start >= 0 && end > start) {
              spans.add(new Span(method.getName().toString(), (int) lines.getLineNumber(start), (int) lines.getLineNumber(end - 1)));
            }
            return super.visitMethod(method, p);
          }
        }.scan(unit, null);
      }
    } catch (IOException | RuntimeException e) {
      return Collections.emptyList();
    }
    return spans;
  }

  /** The narrowest span of that name holding first..last, or null. */
  static Span around(List<Span> spans, String name, int first, int last) {
    Span best = null;
    for (Span s : spans) {
      if (!s.name.equals(name) || s.first > first || last > s.last) continue;
      if (best == null || s.last - s.first < best.last - best.first) best = s;
    }
    return best;
  }
}
