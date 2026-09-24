package dev.varianceauthority.webstorm;

import com.intellij.openapi.Disposable;
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
import java.util.List;
import java.util.Map;
import java.util.Objects;
import javax.swing.Icon;

/**
 * The record, painted in one editor's gutter.
 *
 * <p>Every line the suite ran carries one of five words, and the gutter shows the
 * word: walked by several cases, walked by one alone, run only while its module
 * loaded, a hole a stopped case left, or unwalked by cases that all finished.
 * The icon's tooltip names the cases. Nothing here is a value or a step: the
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
      return;
    }
    Document document = editor.getDocument();
    if ("stale".equals(answer.frame()) && document.getLineCount() > 0) {
      add(markup, 0, 0, "stale", "<b>The record is stale.</b> This file changed since the suite ran, "
          + "and the text it ran over could not be found. Run the suite to record it again.");
      return;
    }
    String frame = "mapped".equals(answer.frame())
        ? "<br><i>Placed in the text as it is now: the file changed since the suite ran.</i>" : "";
    for (Record.Range range : answer.ranges()) {
      int start = range.startLine() - 1;
      int end = Math.min(range.endLine(), document.getLineCount()) - 1;
      if (start < 0 || start > end) continue;
      add(markup, start, end, range.state(), tooltip(range) + frame);
    }
  }

  /** The answer painted last, which the status bar reads. */
  Record.Answer answer() {
    return answer;
  }

  private void add(MarkupModel markup, int startLine, int endLine, String state, String tooltip) {
    Document document = editor.getDocument();
    RangeHighlighter highlighter = markup.addRangeHighlighter(
        document.getLineStartOffset(startLine),
        document.getLineEndOffset(endLine),
        HighlighterLayer.ADDITIONAL_SYNTAX,
        null,
        HighlighterTargetArea.LINES_IN_RANGE);
    highlighter.setGutterIconRenderer(new StateIcon(state, tooltip));
    State known = STATES.get(state);
    if (known != null) {
      highlighter.setErrorStripeMarkColor(known.stripe());
      highlighter.setThinErrorStripeMark(true);
    }
    painted.add(highlighter);
  }

  /** The cases behind one range, and the ones that stopped before it. */
  private static String tooltip(Record.Range range) {
    State state = STATES.getOrDefault(range.state(), STATES.get("entered"));
    StringBuilder html = new StringBuilder()
        .append("<b>").append(state.title()).append("</b> — ").append(state.sentence());
    if (range.moved()) html.append(" These lines were edited since the recording.");
    for (String name : range.cases()) html.append("<br>• ").append(StringUtil.escapeXmlEntities(name));
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

    StateIcon(String state, String tooltip) {
      this.state = state;
      this.tooltip = tooltip;
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
      return other instanceof StateIcon icon && icon.state.equals(state) && icon.tooltip.equals(tooltip);
    }

    @Override
    public int hashCode() {
      return Objects.hash(state, tooltip);
    }
  }
}
