/**
 * The record, painted beside the code in VS Code.
 *
 * Every line the suite ran carries one of five words, and the gutter shows the
 * word: walked by several cases, walked by one alone, run only while its module
 * loaded, a hole a stopped case left, or unwalked by cases that all finished.
 * A hover names the cases. Nothing here is a value or a step: the record says
 * which cases went through a line, not what they saw there.
 *
 * The buffer is asked about as it is held, saved or not, so an edit carries the
 * paint with the code it belongs to instead of leaving it at the recorded line
 * numbers. The CLI does the placing; this module only draws what it answers.
 */

'use strict';

const vscode = require('vscode');
const { ask } = require('./record.js');

/** What each state means, in the words the CLI uses for it. */
const STATES = {
  walked: {
    title: 'Walked',
    sentence: 'Several cases went through these lines.',
    ruler: '#3fb950',
  },
  alone: {
    title: 'One case',
    sentence: 'Exactly one case went through these lines, and every case that could have reached them finished.',
    ruler: '#d29922',
  },
  loaded: {
    title: 'Loaded only',
    sentence: 'These lines ran while their module loaded; no case called into them.',
    ruler: '#8b949e',
  },
  hole: {
    title: 'Hole',
    sentence: 'No case went through these lines, and a case that could have reached them stopped first.',
    ruler: '#f85149',
  },
  unwalked: {
    title: 'Unwalked',
    sentence: 'No case went through these lines, and every case that could have reached them finished.',
    ruler: '#f85149',
  },
  entered: {
    title: 'Entered',
    sentence: 'Cases went through these lines; whether any stopped before them was not recorded.',
    ruler: '#3fb950',
  },
};

const DEBOUNCE_MS = 300;

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const decorations = Object.fromEntries(
    Object.entries(STATES).map(([state, { ruler }]) => [
      state,
      vscode.window.createTextEditorDecorationType({
        gutterIconPath: context.asAbsolutePath(`media/${state}.svg`),
        gutterIconSize: 'contain',
        overviewRulerColor: ruler,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        isWholeLine: true,
      }),
    ]),
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.command = 'variance.refresh';

  /** The last answer per document, by URI. */
  const answers = new Map();
  /** The question in flight per document, so a newer edit cancels it. */
  const pending = new Map();
  const timers = new Map();
  /**
   * Workspace folders with nothing to ask: no CLI, or no recording. Nothing is
   * asked in them until the window comes back to the front, which is when a run
   * in a terminal could have written one; otherwise every pause in typing would
   * start a process to hear the same refusal.
   */
  const quiet = new Set();

  function folderOf(document) {
    if (document.uri.scheme !== 'file') return undefined;
    return vscode.workspace.getWorkspaceFolder(document.uri);
  }

  async function refresh(document) {
    const folder = folderOf(document);
    if (folder === undefined || quiet.has(folder.uri.fsPath)) return;
    const key = document.uri.toString();
    pending.get(key)?.cancel();
    const question = ask({
      root: folder.uri.fsPath,
      file: vscode.workspace.asRelativePath(document.uri, false),
      text: document.getText(),
      command: vscode.workspace.getConfiguration('variance', document.uri).get('command'),
    });
    pending.set(key, question);
    const result = await question.answer;
    if (pending.get(key) !== question || result.cancelled) return;
    pending.delete(key);
    if (result.quiet) quiet.add(folder.uri.fsPath);
    answers.set(key, result);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === key) paint(editor);
    }
  }

  function later(document) {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      void refresh(document);
    }, DEBOUNCE_MS));
  }

  function paint(editor) {
    const result = answers.get(editor.document.uri.toString());
    const ranges = result?.answer?.ranges ?? [];
    for (const [state, type] of Object.entries(decorations)) {
      editor.setDecorations(
        type,
        ranges
          .filter((range) => (range.state ?? 'entered') === state)
          .map((range) => new vscode.Range(range.startLine - 1, 0, range.endLine - 1, 0)),
      );
    }
    if (editor === vscode.window.activeTextEditor) describe(result);
  }

  function describe(result) {
    // A workspace with no CLI or no recording is not one of ours; the bar stays as it was.
    if (result === undefined || result.quiet) return status.hide();
    if (result.refusal !== undefined) {
      status.text = '$(circle-slash) variance';
      status.tooltip = result.refusal;
    } else if (result.answer.frame === 'stale') {
      status.text = '$(warning) variance: record is stale';
      status.tooltip = 'This file changed since the suite ran, and the text it ran over could not be found. ' +
        'Run the suite to record it again.';
    } else {
      const ranges = result.answer.ranges ?? [];
      const holes = ranges.filter((range) => range.state === 'hole').length;
      status.text = holes === 0
        ? '$(beaker) variance'
        : `$(beaker) variance: ${holes} hole${holes === 1 ? '' : 's'}`;
      status.tooltip = result.answer.frame === 'mapped'
        ? 'Placed in the text as it is now: the file changed since the suite ran.'
        : 'Painted from the recording of the last run.';
    }
    status.show();
  }

  function rangeAt(document, line) {
    const ranges = answers.get(document.uri.toString())?.answer?.ranges ?? [];
    return ranges.find((range) => range.startLine <= line && line <= range.endLine);
  }

  const hover = vscode.languages.registerHoverProvider({ scheme: 'file' }, {
    provideHover(document, position) {
      const range = rangeAt(document, position.line + 1);
      if (range === undefined) return undefined;
      return new vscode.Hover(hoverText(range));
    },
  });

  const casesAtLine = vscode.commands.registerCommand('variance.casesAtLine', async () => {
    const editor = vscode.window.activeTextEditor;
    const folder = editor && folderOf(editor.document);
    if (folder === undefined) return;
    const line = editor.selection.active.line + 1;
    const { answer, refusal } = await ask({
      root: folder.uri.fsPath,
      file: vscode.workspace.asRelativePath(editor.document.uri, false),
      text: editor.document.getText(),
      line,
      command: vscode.workspace.getConfiguration('variance', editor.document.uri).get('command'),
    }).answer;
    if (refusal !== undefined) return void vscode.window.showWarningMessage(refusal);
    const items = [
      ...(answer.tests ?? []).map((test) => ({ label: test.name, description: test.file, file: test.file })),
      ...(answer.stopped ?? []).map((test) => ({
        label: `$(debug-stop) ${test.name}`,
        description: `${test.file} — stopped before reaching this line`,
        file: test.file,
      })),
    ];
    if (items.length === 0) {
      return void vscode.window.showInformationMessage(`No case went through line ${line}.`);
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: `Cases through line ${line}${answer.state ? ` — ${STATES[answer.state].title}` : ''}`,
    });
    if (picked !== undefined) {
      await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, picked.file));
    }
  });

  context.subscriptions.push(
    status,
    hover,
    casesAtLine,
    ...Object.values(decorations),
    vscode.commands.registerCommand('variance.refresh', () => {
      quiet.clear();
      for (const editor of vscode.window.visibleTextEditors) void refresh(editor.document);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => later(event.document)),
    vscode.workspace.onDidSaveTextDocument((document) => void refresh(document)),
    vscode.workspace.onDidCloseTextDocument((document) => answers.delete(document.uri.toString())),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        if (answers.has(editor.document.uri.toString())) paint(editor);
        else void refresh(editor.document);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor === undefined) return status.hide();
      describe(answers.get(editor.document.uri.toString()));
    }),
    // A suite run in a terminal writes a new recording; coming back to the
    // window is when the person expects the paint to follow it.
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) return;
      quiet.clear();
      for (const editor of vscode.window.visibleTextEditors) void refresh(editor.document);
    }),
  );

  for (const editor of vscode.window.visibleTextEditors) void refresh(editor.document);
}

/** The cases behind one range, and the ones that stopped before it. */
function hoverText(range) {
  const state = STATES[range.state ?? 'entered'];
  const text = new vscode.MarkdownString();
  text.appendMarkdown(`**${state.title}** — ${state.sentence}`);
  if (range.moved) text.appendMarkdown(' These lines were edited since the recording.');
  const called = range.tests.filter((test) => test.loaded !== true);
  if (called.length > 0) {
    text.appendMarkdown('\n\n');
    for (const test of called) text.appendMarkdown(`- ${escape(test.name)} — \`${test.file}\`\n`);
  }
  if ((range.stopped ?? []).length > 0) {
    text.appendMarkdown('\n\nStopped before reaching these lines:\n\n');
    for (const test of range.stopped) text.appendMarkdown(`- ${escape(test.name)} — \`${test.file}\`\n`);
  }
  return text;
}

function escape(text) {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

function deactivate() {}

module.exports = { activate, deactivate };
