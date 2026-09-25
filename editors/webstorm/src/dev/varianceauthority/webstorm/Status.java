package dev.varianceauthority.webstorm;

import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.fileEditor.FileEditorManagerEvent;
import com.intellij.openapi.fileEditor.FileEditorManagerListener;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.StatusBar;
import com.intellij.openapi.wm.StatusBarWidget;
import com.intellij.openapi.wm.StatusBarWidgetFactory;
import com.intellij.openapi.wm.WindowManager;
import com.intellij.openapi.wm.impl.status.EditorBasedWidget;
import java.awt.Component;
import org.jetbrains.annotations.NotNull;

/**
 * What the record said about the file in front of you, in the status bar.
 *
 * <p>The gutter shows what was painted; this says why nothing was, when nothing
 * was. A missing recording, a CLI that is not installed and a record too stale
 * to place are each an answer, and without this they reached only
 * {@code idea.log}. The words are the VS Code client's, so the two editors say
 * the same thing about the same file.
 */
final class Status extends EditorBasedWidget implements StatusBarWidget.TextPresentation {
  static final String ID = "dev.variance-authority.status";

  Status(Project project) {
    super(project);
    // Another file in front is another answer.
    project.getMessageBus().connect(this).subscribe(FileEditorManagerListener.FILE_EDITOR_MANAGER,
        new FileEditorManagerListener() {
          @Override
          public void selectionChanged(@NotNull FileEditorManagerEvent event) {
            if (myStatusBar != null) myStatusBar.updateWidget(ID);
          }
        });
  }

  /** Redraw the widget in the window that shows this editor. */
  static void update(Editor editor) {
    Project project = editor.getProject();
    if (project == null || project.isDisposed()) return;
    StatusBar bar = WindowManager.getInstance().getStatusBar(project);
    if (bar != null) bar.updateWidget(ID);
  }

  @Override
  public @NotNull String ID() {
    return ID;
  }

  @Override
  public WidgetPresentation getPresentation() {
    return this;
  }

  @Override
  public @NotNull String getText() {
    Record.Answer answer = shown();
    // A project with no CLI or no recording is not one of ours; the bar stays as it was.
    if (answer == null || answer.quiet()) return "";
    if (answer.refusal() != null) return "variance: not painted";
    if ("stale".equals(answer.frame())) return "variance: record is stale";
    long holes = answer.ranges().stream().filter((range) -> "hole".equals(range.state())).count();
    return holes == 0 ? "variance" : "variance: " + holes + (holes == 1 ? " hole" : " holes");
  }

  @Override
  public String getTooltipText() {
    Record.Answer answer = shown();
    if (answer == null || answer.quiet()) return null;
    if (answer.refusal() != null) return answer.refusal();
    if ("stale".equals(answer.frame())) {
      return "This file changed since the suite ran, and the text it ran over could not be found. "
          + "Run the suite to record it again.";
    }
    return "mapped".equals(answer.frame())
        ? "Placed in the text as it is now: the file changed since the suite ran."
        : "Painted from the recording of the last run.";
  }

  @Override
  public float getAlignment() {
    return Component.LEFT_ALIGNMENT;
  }

  /** The last answer painted in the selected editor, or none when it is not a project file. */
  private Record.Answer shown() {
    Editor editor = getEditor();
    return editor == null ? null : Editors.answerFor(editor);
  }

  /** Registered in {@code plugin.xml}; one widget per project window. */
  public static final class Factory implements StatusBarWidgetFactory {
    @Override
    public @NotNull String getId() {
      return ID;
    }

    @Override
    public @NotNull String getDisplayName() {
      return "Variance Authority";
    }

    @Override
    public @NotNull StatusBarWidget createWidget(@NotNull Project project) {
      return new Status(project);
    }
  }
}
