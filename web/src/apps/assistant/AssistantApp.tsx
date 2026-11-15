import { Bot, Send, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ApiError, api, type AiAnswerData, type AiPrepared, type AiSettings } from '../../lib/api';
import { requestRun } from '../../runner/runStore';
import { useAssistant } from '../../stores/assistantStore';
import { useServers } from '../../stores/serverStore';

const errText = (e: unknown) =>
  e instanceof ApiError ? e.detail : e instanceof Error ? e.message : 'Something went wrong.';
const SELECT =
  'h-9 rounded-control border border-border bg-background px-2 text-body focus-visible:outline-offset-1';

const RISK: Record<string, string> = {
  safe: 'bg-success/10 text-success',
  caution: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
};

interface Turn {
  question: string;
  answer: AiAnswerData;
}

/**
 * Ask questions, or have an error explained. Nothing is ever sent on its own: you see the exact text first (secrets
 * already removed) and where it goes, then press Send. The assistant can only PROPOSE actions; each one opens the
 * normal review dialog.
 */
export function AssistantApp() {
  const activeId = useServers((s) => s.activeId);
  const prefill = useAssistant((s) => s.prefill);
  const setPrefill = useAssistant((s) => s.setPrefill);
  const refreshEnabled = useAssistant((s) => s.refresh);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [kind, setKind] = useState<'ask' | 'explain'>('ask');
  const [text, setText] = useState('');
  const [prepared, setPrepared] = useState<AiPrepared | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // settings form
  const [form, setForm] = useState({
    enabled: false,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    baseUrl: '',
    apiKey: '',
  });

  useEffect(() => {
    void api.aiSettings().then((s) => {
      setSettings(s);
      setForm({
        enabled: s.enabled,
        provider: s.provider,
        model: s.model,
        baseUrl: s.baseUrl,
        apiKey: '',
      });
      setShowSettings(!s.enabled);
    });
  }, []);
  useEffect(() => {
    if (!prefill) return;
    setKind(prefill.kind);
    setText(prefill.text);
    setPrepared(null);
    setPrefill(null);
  }, [prefill, setPrefill]);

  const save = async () => {
    setError('');
    try {
      const s = await api.aiSave({ ...form, apiKey: form.apiKey || undefined });
      setSettings(s);
      setForm((f) => ({ ...f, apiKey: '' }));
      void refreshEnabled();
      if (s.enabled) setShowSettings(false);
    } catch (e) {
      setError(errText(e));
    }
  };

  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      setPrepared(await api.aiPrepare({ kind, text }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!prepared) return;
    setBusy(true);
    setError('');
    try {
      const answer = await api.aiSend(prepared.previewId);
      setTurns((t) => [{ question: text, answer }, ...t]);
      setPrepared(null);
      setText('');
    } catch (e) {
      setError(errText(e));
      setPrepared(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col text-body">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
        <Bot size={18} className="text-link" />
        <span className="font-medium">Assistant</span>
        {settings && (
          <span data-testid="ai-destination" className="text-footnote text-muted-foreground">
            {settings.enabled
              ? settings.local
                ? `stays on this computer (${settings.destination})`
                : `sends to ${settings.destination}`
              : 'turned off'}
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => setShowSettings((v) => !v)}
        >
          Settings
        </Button>
      </div>

      {showSettings && (
        <div
          data-testid="ai-settings"
          className="grid shrink-0 gap-2 border-b border-border bg-sunken p-3 sm:grid-cols-2"
        >
          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>Turn the assistant on</span>
          </label>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-provider">Provider</Label>
            <select
              id="ai-provider"
              className={SELECT}
              value={form.provider}
              onChange={(e) =>
                setForm({
                  ...form,
                  provider: e.target.value,
                  model: e.target.value === 'anthropic' ? 'claude-sonnet-5-5' : 'llama3.2',
                  baseUrl: e.target.value === 'anthropic' ? '' : 'http://127.0.0.1:11434/v1',
                })
              }
            >
              <option value="anthropic">Anthropic (Claude): needs your API key</option>
              <option value="openai-compatible">
                Any OpenAI-compatible server (Ollama: stays on your computer)
              </option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-model">Model</Label>
            <Input
              id="ai-model"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
          </div>
          {form.provider === 'openai-compatible' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="ai-url">Server address</Label>
              <Input
                id="ai-url"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-key">
              API key{' '}
              {settings?.hasKey
                ? '(saved: leave empty to keep it)'
                : form.provider === 'anthropic'
                  ? ''
                  : '(optional)'}
            </Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </div>
          <p className="flex items-start gap-1.5 text-footnote text-muted-foreground sm:col-span-2">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
            The key is encrypted with your master password. Nothing is sent until you preview the
            exact text and press Send; passwords, tokens and private keys are removed first. The
            assistant cannot run anything: it can only suggest actions you then review.
          </p>
          <div className="sm:col-span-2">
            <Button size="sm" onClick={() => void save()}>
              Save settings
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" data-testid="ai-error" className="p-2 text-footnote text-danger">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {settings?.enabled && (
          <section className="rounded-xl border border-separator p-3">
            <div className="mb-2 flex gap-1" role="tablist">
              {(['ask', 'explain'] as const).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  role="tab"
                  aria-selected={kind === k}
                  variant={kind === k ? 'default' : 'outline'}
                  onClick={() => setKind(k)}
                >
                  {k === 'ask' ? 'Ask a question' : 'Explain a command or error'}
                </Button>
              ))}
            </div>
            <textarea
              aria-label="Your message"
              rows={4}
              className="w-full rounded-control border border-border bg-background p-2 text-footnote focus-visible:outline-offset-1"
              placeholder={
                kind === 'ask'
                  ? 'For example: how do I see which program uses port 8080?'
                  : 'Paste a command or the error you got'
              }
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPrepared(null);
              }}
            />
            <Button
              size="sm"
              className="mt-2"
              disabled={busy || !text.trim()}
              onClick={() => void preview()}
            >
              Preview what will be sent
            </Button>

            {prepared && (
              <div
                data-testid="ai-preview"
                className="mt-3 rounded-lg border border-separator bg-sunken p-3"
              >
                <p className="text-footnote font-semibold">
                  {prepared.local
                    ? `This stays on your computer (${prepared.destination}).`
                    : `This will be sent to ${prepared.destination}.`}{' '}
                  Model: {prepared.model}
                </p>
                {prepared.scrubbed && (
                  <p data-testid="ai-scrubbed" className="mt-1 text-footnote text-warning">
                    Passwords or tokens were found and removed from the text below.
                  </p>
                )}
                <pre
                  data-testid="ai-payload"
                  className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-footnote"
                >
                  {prepared.user}
                </pre>
                <details className="mt-1 text-footnote text-muted-foreground">
                  <summary className="cursor-pointer">
                    Instructions GFV also sends (the list of actions it may suggest)
                  </summary>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap">
                    {prepared.system}
                  </pre>
                </details>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void send()}>
                    <Send size={12} /> Send
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setPrepared(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        <ul className="mt-3 flex flex-col gap-3">
          {turns.map((t, i) => (
            <li key={i} data-testid="ai-turn" className="rounded-xl border border-separator p-3">
              <p className="text-footnote text-muted-foreground">
                You asked: {t.question.slice(0, 160)}
              </p>
              <p data-testid="ai-answer" className="mt-1 whitespace-pre-wrap">
                {t.answer.answer}
              </p>
              {t.answer.proposals.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <p className="text-caption font-semibold uppercase tracking-wide text-faint-foreground">
                    Suggested actions (you review each one before it runs)
                  </p>
                  {t.answer.proposals.map((p, j) => (
                    <div
                      key={j}
                      data-testid="ai-proposal"
                      className="flex flex-wrap items-center gap-2 rounded-lg bg-sunken p-2"
                    >
                      <span className={`rounded-full px-2 py-px text-caption ${RISK[p.risk]}`}>
                        {p.risk}
                      </span>
                      <span className="min-w-0 flex-1 text-footnote">
                        <b>{p.title}</b>
                        {p.why && <span className="text-muted-foreground"> · {p.why}</span>}
                      </span>
                      <Button
                        size="sm"
                        disabled={!activeId}
                        title={activeId ? '' : 'Pick a server first'}
                        onClick={() =>
                          activeId &&
                          requestRun({ serverId: activeId, actionId: p.actionId, params: p.params })
                        }
                      >
                        Review and run…
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {t.answer.rejected > 0 && (
                <p className="mt-1 text-caption text-muted-foreground">
                  {t.answer.rejected} suggestion(s) were dropped because they did not match a real
                  action.
                </p>
              )}
            </li>
          ))}
        </ul>
        {settings && !settings.enabled && !showSettings && (
          <p className="p-6 text-center text-muted-foreground">
            The assistant is turned off. Open Settings to turn it on.
          </p>
        )}
      </div>
    </div>
  );
}
