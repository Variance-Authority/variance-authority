package dev.varianceauthority.webstorm;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.DocumentListener;
import com.intellij.openapi.editor.markup.GutterIconRenderer;
import com.intellij.openapi.editor.markup.HighlighterLayer;
import com.intellij.openapi.editor.markup.HighlighterTargetArea;
import com.intellij.openapi.editor.markup.MarkupModel;
import com.intellij.openapi.editor.markup.RangeHighlighter;
import com.intellij.openapi.util.IconLoader;
import com.intellij.openapi.util.text.StringUtil;
import com.intellij.util.Alarm;
import java.awt.Color;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import javax.swing.Icon;
import org.jetbrains.annotations.NotNull;

/**
 * The record, painted in one editor's gutter.
 *
 * <p>Every line the suite ran carries one of five words, and the gutter shows the
 * word: walked by several cases, walked by one alone, run only while its module
 * loaded, a hole a stopped case left, or unwalked by cases that all finished.
 * The icon's tooltip counts the cases by test file, and a click lists them
 * nearest first, one step from the code they declare. Nothing here is a value or a step: the
 * record says which cases went through a line, not what they saw there.
 *
 * <p>The buffer is asked about as it is held, saved or not, so an edit carries
 * the paint with the code it belongs to instead of leaving it at the recorded
 * line numbers.
 */
final class Painter implements Disposable {
  private static final Logger LOG = Logger.getInstance(Painter.class);
  private static final int DEBOUNCE_MS = 300;

  /** What each state means, in the words the CLI uses for it. */
  private record State(String title, String sentence, Color stripe) {}

  private static final Map<String, State> STATES = Map.of(
      "walked", new State("Walked", "Several cases went through these lines.", new Color(0x3fb950)),
      "alone", new State("One case",
          "Exactly one case went through these lines, and every case that could have reached them finished.",
          new Color(0xd29922)),
      "loaded", new State("Loaded only",
          "These lines ran while their module loaded; no case called into them.", new Color(0x8b949e)),
      "hole", new State("Hole",
          "No case went through these lines, and a case that could have reached them stopped first.",
          new Color(0xf85149)),
      "unwalked", new State("Unwalked",
          "No case went through these lines, and every case that could have reached them finished.",
          new Color(0xf85149)),
      "entered", new State("Entered",
          "Cases went through these lines; whether any stopped before them was not recorded.",
          new Color(0x3fb950)));

  private final Editor editor;
  private final String root;
  private final String file;
  private final Alarm alarm = new Alarm(Alarm.ThreadToUse.POOLED_THREAD, this);
  private final List<RangeHighlighter> painted = new ArrayList<>();
  private volatile Record.Answer answer;

  Painter(Editor editor, String root, String file) {
    this.editor = editor;
    this.root = root;
    this.file = file;
    editor.getDocument().addDocumentListener(new DocumentListener() {
      @Override
      public void documentChanged(DocumentEvent event) {
        refresh();
      }
    }, this);
    refresh();
  }

  /** Ask again once the edits stop for a moment; a newer edit replaces a pending question. */
  void refresh() {
    alarm.cancelAllRequests();
    if (Editors.quiet(root)) return;
    alarm.addRequest(this::ask, DEBOUNCE_MS);
  }

  private void ask() {
    Document document = editor.getDocument();
    long stamp = document.getModificationStamp();
    // An immutable snapshot, safe to read off the event thread without a read action.
    String text = document.getImmutableCharSequence().toString();
    Record.Answer answer = Record.ask(root, file, text);
    ApplicationManager.getApplication().invokeLater(() -> {
      // A newer edit asked its own question; this answer is for a text nobody holds.
      if (editor.isDisposed() || document.getModificationStamp() != stamp) return;
      paint(answer);
    });
  }

  private void paint(Record.Answer answer) {
    MarkupModel markup = editor.getMarkupModel();
    for (RangeHighlighter highlighter : painted) markup.removeHighlighter(highlighter);
    painted.clear();
    this.answer = answer;
    Status.update(editor);
    if (answer.refusal() != null) {
      LOG.info("variance: " + answer.refusal());
      if (answer.quiet()) Editors.hush(root);
      return;
    }
    Document document = editor.getDocument();
    if ("stale".equals(answer.frame()) && document.getLineCount() > 0) {
      add(markup, 0, 0, "stale", "<b>The record is stale.</b> This file changed since the suite ran, "
          + "and the text it ran over could not be found. Run the suite to record it again.", null);
      return;
    }
    String frame = "mapped".equals(answer.frame())
        ? "<br><i>Placed in the text as it is now: the file changed since the suite ran.</i>" : "";
    for (Record.Range range : answer.ranges()) {
      int start = range.startLine() - 1;
      int end = Math.min(range.endLine(), document.getLineCount()) - 1;
      if (start < 0 || start > end) continue;
      int line = range.startLine();
      Runnable list = range.cases().isEmpty() ? null : () -> Cases.show(editor, root, file, line);
      add(markup, start, end, range.state(), tooltip(range) + frame, list);
    }
  }

  /** The answer painted last, which the status bar reads. */
  Record.Answer answer() {
    return answer;
  }

  private void add(MarkupModel markup, int startLine, int endLine, String state, String tooltip, Runnable click) {
    Document document = editor.getDocument();
    RangeHighlighter highlighter = markup.addRangeHighlighter(
        document.getLineStartOffset(startLine),
        document.getLineEndOffset(endLine),
        HighlighterLayer.ADDITIONAL_SYNTAX,
        null,
        HighlighterTargetArea.LINES_IN_RANGE);
    highlighter.setGutterIconRenderer(new StateIcon(state, tooltip, startLine, click));
    State known = STATES.get(state);
    if (known != null) {
      highlighter.setErrorStripeMarkColor(known.stripe());
      highlighter.setThinErrorStripeMark(true);
    }
    painted.add(highlighter);
  }

  /** Test files named in a tooltip before the rest are left to the list a click opens. */
  private static final int NAMED_FILES = 10;

  /**
   * The cases behind one range, counted per test file, and the ones that stopped before it.
   *
   * <p>A base module is walked by hundreds of test files; a tooltip naming every
   * case would be a page nobody reads. The files are named with their counts, a
   * handful of them, and the click answers the rest in order.
   */
  private static String tooltip(Record.Range range) {
    State state = STATES.getOrDefault(range.state(), STATES.get("entered"));
    StringBuilder html = new StringBuilder()
        .append("<b>").append(state.title()).append("</b> — ").append(state.sentence());
    if (range.moved()) html.append(" These lines were edited since the recording.");
    Map<String, Integer> files = new LinkedHashMap<>();
    for (Record.Case test : range.cases()) files.merge(test.file(), 1, Integer::sum);
    int named = 0;
    for (Map.Entry<String, Integer> entry : files.entrySet()) {
      if (named++ == NAMED_FILES) break;
      html.append("<br>• ").append(StringUtil.escapeXmlEntities(entry.getKey()));
      if (entry.getValue() > 1) html.append(" — ").append(entry.getValue()).append(" cases");
    }
    if (files.size() > NAMED_FILES) {
      html.append("<br>…and ").append(files.size() - NAMED_FILES).append(" more files");
    }
    if (!files.isEmpty()) html.append("<br><i>Click for every case, nearest test file first.</i>");
    if (!range.stopped().isEmpty()) {
      html.append("<br><br>Stopped before reaching these lines:");
      for (String name : range.stopped()) html.append("<br>• ").append(StringUtil.escapeXmlEntities(name));
    }
    return html.toString();
  }

  @Override
  public void dispose() {
    if (editor.isDisposed()) return;
    MarkupModel markup = editor.getMarkupModel();
    for (RangeHighlighter highlighter : painted) markup.removeHighlighter(highlighter);
    painted.clear();
  }

  /** One state's gutter icon; equal icons let the platform skip a repaint. */
  private static final class StateIcon extends GutterIconRenderer {
    private final String state;
    private final String tooltip;
    private final int line;
    private final Runnable click;

    /** The line is part of the identity: a kept icon would click through to where the range used to be. */
    StateIcon(String state, String tooltip, int line, Runnable click) {
      this.state = state;
      this.tooltip = tooltip;
      this.line = line;
      this.click = click;
    }

    @Override
    public AnAction getClickAction() {
      if (click == null) return null;
      return new AnAction() {
        @Override
        public void actionPerformed(@NotNull AnActionEvent event) {
          click.run();
        }
      };
    }

    @Override
    public Icon getIcon() {
      return IconLoader.getIcon("/icons/variance/" + state + ".svg", Painter.class);
    }

    @Override
    public String getTooltipText() {
      return "<html>" + tooltip + "</html>";
    }

    @Override
    public boolean equals(Object other) {
      return other instanceof StateIcon icon && icon.state.equals(state) && icon.tooltip.equals(tooltip)
          && icon.line == line;
    }

    @Override
    public int hashCode() {
      return Objects.hash(state, tooltip, line);
    }
  }
}
