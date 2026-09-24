package dev.varianceauthority.webstorm;

import com.intellij.openapi.application.ApplicationActivationListener;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.event.EditorFactoryEvent;
import com.intellij.openapi.editor.event.EditorFactoryListener;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.vfs.VfsUtilCore;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.wm.IdeFrame;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * One painter per open editor on a file inside a project, and a fresh reading
 * for every painter when the IDE comes back to the front.
 *
 * <p>A suite run in a terminal writes a new recording; coming back to the window
 * is when the person expects the paint to follow it.
 */
public final class Editors implements EditorFactoryListener, ApplicationActivationListener {
  private static final Map<Editor, Painter> PAINTERS = new ConcurrentHashMap<>();

  @Override
  public void editorCreated(EditorFactoryEvent event) {
    Editor editor = event.getEditor();
    Project project = editor.getProject();
    VirtualFile file = FileDocumentManager.getInstance().getFile(editor.getDocument());
    if (project == null || file == null || !file.isInLocalFileSystem() || project.getBasePath() == null) return;
    VirtualFile base = file.getFileSystem().findFileByPath(project.getBasePath());
    String relative = base == null ? null : VfsUtilCore.getRelativePath(file, base);
    if (relative == null) return;
    PAINTERS.put(editor, new Painter(editor, project.getBasePath(), relative));
  }

  @Override
  public void editorReleased(EditorFactoryEvent event) {
    Painter painter = PAINTERS.remove(event.getEditor());
    if (painter != null) Disposer.dispose(painter);
  }

  /** The answer last painted in this editor, or none before the first one arrives. */
  static Record.Answer answerFor(Editor editor) {
    Painter painter = PAINTERS.get(editor);
    return painter == null ? null : painter.answer();
  }

  @Override
  public void applicationActivated(IdeFrame frame) {
    for (Painter painter : PAINTERS.values()) painter.refresh();
  }
}
