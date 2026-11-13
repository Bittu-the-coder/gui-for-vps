import { DiffEditor } from '@monaco-editor/react';
import './monacoSetup';

export interface MonacoDiffProps {
  /** Unique per comparison, so each gets its own models; the extension picks the highlighting. */
  modelKey: string;
  original: string;
  modified: string;
  dark: boolean;
}

export default function MonacoDiff({ modelKey, original, modified, dark }: MonacoDiffProps) {
  return (
    <DiffEditor
      originalModelPath={`inmemory://diff-a/${modelKey}`}
      modifiedModelPath={`inmemory://diff-b/${modelKey}`}
      original={original}
      modified={modified}
      theme={dark ? 'vs-dark' : 'light'}
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        fontSize: 13,
      }}
      loading={<div className="p-3 text-xs text-muted-foreground">Loading diff…</div>}
    />
  );
}
