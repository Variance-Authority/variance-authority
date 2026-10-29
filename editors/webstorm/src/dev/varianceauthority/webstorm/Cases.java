package dev.varianceauthority.webstorm;

import com.intellij.codeInsight.hint.HintManager;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.OpenFileDescriptor;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.ProgressManager;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import com.intellij.openapi.ui.popup.ListSeparator;
import com.intellij.openapi.ui.popup.PopupStep;
import com.intellij.openapi.ui.popup.util.BaseListPopupStep;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import org.jetbrains.annotations.NotNull;

/**
 * The cases behind one gutter mark, one row per test file, nearest first.
 *
 * <p>A base module is reached by hundreds of test files and thousands of cases,
 * and a tooltip naming all of them answers nothing. The popup names each file
 * once with how many of its cases went through the line out of how many it
 * has, and how many imports away it sits, under the suite that ran it when
 * several are declared. The CLI sorts and counts; this only lists. A file opens
 * to its cases, and a case opens where it is declared.
 */
final class Cases {
  private Cases() {}

  /** Ask about the line in the background, then open the list beside the editor. */
  static void show(Editor editor, String root, String file, int line) {
    Project project = editor.getProject();
    if (project == null) return;
    String text = editor.getDocument().getImmutableCharSequence().toString();
    ProgressManager.getInstance().run(new Task.Backgroundable(project, "Asking variance about line " + line) {
      private Record.Line answer;

      @Override
      public void run(@NotNull ProgressIndicator indicator) {
        answer = Record.askLine(root, file, text, line);
      }

      @Override
      public void onSuccess() {
        if (editor.isDisposed()) return;
        if (answer.refusal() != null) {
          HintManager.getInstance().showErrorHint(editor, answer.refusal());
        } else {
          List<Row> rows = new ArrayList<>();
          int cases = 0;
          for (Record.SuiteLine suite : answer.suites()) {
            for (Record.TestFile file : suite.files()) rows.add(new Row(suite, file));
            cases += suite.cases().size();
          }
          if (rows.isEmpty()) {
            HintManager.getInstance().showInformationHint(editor, "No case called into line " + line + ".");
          } else {
            JBPopupFactory.getInstance()
                .createListPopup(new Files(project, root, cases + " cases went through line " + line, rows))
                .showInBestPositionFor(editor);
          }
        }
      }
    });
  }

  /** How one file reads in the list: its path, its share of the line, and its distance. */
  static String row(Record.TestFile file) {
    String hops = file.hops() == null ? "" : " · " + file.hops() + (file.hops() == 1 ? " hop" : " hops");
    return file.file() + "   " + file.cases() + "/" + file.of() + hops;
  }

  /** One test file in the list, with the suite whose record named it. */
  private record Row(Record.SuiteLine suite, Record.TestFile file) {}

  private static final class Files extends BaseListPopupStep<Row> {
    private final Project project;
    private final String root;

    Files(Project project, String root, String title, List<Row> rows) {
      super(title, rows);
      this.project = project;
      this.root = root;
    }

    @Override
    public @NotNull String getTextFor(Row row) {
      return row(row.file());
    }

    /** Each declared suite's files under its name, nearest suite first as the CLI ordered them. */
    @Override
    public ListSeparator getSeparatorAbove(Row row) {
      if (row.suite().name() == null) return null;
      int at = getValues().indexOf(row);
      if (at > 0 && getValues().get(at - 1).suite() == row.suite()) return null;
      return new ListSeparator(row.suite().name() + " (" + row.suite().kind() + ")");
    }

    @Override
    public boolean isSpeedSearchEnabled() {
      return true;
    }

    @Override
    public boolean hasSubstep(Row row) {
      return true;
    }

    @Override
    public PopupStep<?> onChosen(Row row, boolean finalChoice) {
      List<Record.Case> cases = new ArrayList<>();
      for (Record.Case test : row.suite().cases()) if (test.file().equals(row.file().file())) cases.add(test);
      return new CasesOf(project, root, row.file(), cases);
    }
  }

  /** One file's cases, with the file itself first. */
  private static final class CasesOf extends BaseListPopupStep<Record.Case> {
    private final Project project;
    private final String root;
    private final Record.TestFile file;

    CasesOf(Project project, String root, Record.TestFile file, List<Record.Case> cases) {
      super(null, withFile(file, cases));
      this.project = project;
      this.root = root;
      this.file = file;
    }

    private static List<Record.Case> withFile(Record.TestFile file, List<Record.Case> cases) {
      List<Record.Case> rows = new ArrayList<>();
      rows.add(new Record.Case(file.file(), null));
      rows.addAll(cases);
      return rows;
    }

    @Override
    public @NotNull String getTextFor(Record.Case test) {
      return test.name() == null ? "Open " + new File(file.file()).getName() : test.name();
    }

    @Override
    public boolean isSpeedSearchEnabled() {
      return true;
    }

    @Override
    public PopupStep<?> onChosen(Record.Case test, boolean finalChoice) {
      return doFinalStep(() -> open(project, root, test));
    }
  }

  private static void open(Project project, String root, Record.Case test) {
    VirtualFile file = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(new File(root, test.file()));
    if (file == null) return;
    new OpenFileDescriptor(project, file, test.name() == null ? 0 : declared(file, test.name())).navigate(true);
  }

  /**
   * Where a case's title stands in its file, or the top when it cannot be found.
   *
   * <p>The name is the path of titles from the outermost describe, joined by
   * {@code " > "}; the last one is what the file spells.
   */
  // TODO: the record does not carry the line a case is declared on, so its
  // title is searched for; a title built at runtime lands at the top of the file.
  private static int declared(VirtualFile file, String name) {
    var document = FileDocumentManager.getInstance().getDocument(file);
    if (document == null) return 0;
    String text = document.getText();
    int last = name.lastIndexOf(" > ");
    String title = last < 0 ? name : name.substring(last + 3);
    for (String quote : new String[] {"'", "\"", "`"}) {
      int at = text.indexOf(quote + title + quote);
      if (at >= 0) return at;
    }
    return 0;
  }
}
