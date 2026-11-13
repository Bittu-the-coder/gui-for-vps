import { loader } from '@monaco-editor/react';
// Bundle Monaco ourselves (works offline, no CDN). Only the editor core and the lightweight
// syntax highlighters are loaded: no TypeScript/JSON language services, so only ONE worker.
import 'monaco-editor/esm/vs/editor/editor.all';
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

(self as unknown as { MonacoEnvironment: object }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
loader.config({ monaco });
