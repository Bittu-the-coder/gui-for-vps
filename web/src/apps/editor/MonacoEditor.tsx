import Editor, { loader } from '@monaco-editor/react';
import { useRef } from 'react';
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

export interface MonacoEditorProps {
  /** Unique per open file (so each window gets its own model). */
  modelPath: string;
  value: string;
  dark: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

export default function MonacoEditor({
  modelPath,
  value,
  dark,
  onChange,
  onSave,
}: MonacoEditorProps) {
  // onMount runs once; this ref always points at the latest save handler (per editor window).
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  return (
    <Editor
      path={modelPath}
      defaultValue={value}
      theme={dark ? 'vs-dark' : 'light'}
      onChange={(v) => onChange(v ?? '')}
      onMount={(editor, m) => {
        // The mount callback runs once, so keep the latest save handler reachable.
        editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveRef.current());
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        automaticLayout: true,
        scrollBeyondLastLine: false,
      }}
      loading={<div className="p-3 text-xs text-muted-foreground">Loading editor…</div>}
    />
  );
}
