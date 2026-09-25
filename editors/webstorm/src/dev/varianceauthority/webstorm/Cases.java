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
 * has, and how many imports away it sits. The CLI sorts and counts; this only
 * lists. A file opens to its cases, and a case opens where it is declared.
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
        } else if (answer.files().isEmpty()) {
          HintManager.getInstance().showInformationHint(editor,
              "No case called into line " + line + ".");
        } else {
          JBPopupFactory.getInstance()
              .createListPopup(new Files(project, root, line, answer))
              .showInBestPositionFor(editor);
        }
      }
    });
  }

  /** How one file reads in the list: its path, its share of the line, and its distance. */
  static String row(Record.TestFile file) {
    String hops = file.hops() == null ? "" : " · " + file.hops() + (file.hops() == 1 ? " hop" : " hops");
    return file.file() + "   " + file.cases() + "/" + file.of() + hops;
  }

  private static final class Files extends BaseListPopupStep<Record.TestFile> {
    private final Project project;
    private final String root;
    private final Record.Line answer;

    Files(Project project, String root, int line, Record.Line answer) {
      super(answer.cases().size() + " cases in " + answer.files().size() + " files went through line " + line,
          answer.files());
      this.project = project;
      this.root = root;
      this.answer = answer;
    }

    @Override
    public @NotNull String getTextFor(Record.TestFile file) {
      return row(file);
    }

    @Override
    public boolean isSpeedSearchEnabled() {
      return true;
    }

    @Override
    public boolean hasSubstep(Record.TestFile file) {
      return true;
    }

    @Override
    public PopupStep<?> onChosen(Record.TestFile file, boolean finalChoice) {
      List<Record.Case> cases = new ArrayList<>();
      for (Record.Case test : answer.cases()) if (test.file().equals(file.file())) cases.add(test);
      return new CasesOf(project, root, file, cases);
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
