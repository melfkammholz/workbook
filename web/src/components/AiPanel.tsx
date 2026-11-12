import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_PROMPT_TEMPLATE, PROMPT_PLACEHOLDERS } from '@wb/shared';
import { fetchAiPrompt, useSaveSettings, useSettings, type PromptRequest } from '@/lib/api';
import { useLang, useT } from '@/lib/i18n';
import { Button } from './ui';

export const CHATS: [string, string][] = [
  ['Claude', 'https://claude.ai/new'],
  ['ChatGPT', 'https://chatgpt.com/'],
];

/**
 * A second opinion on the current answer: the student copies a prompt into a chat
 * of their own, which needs no setup and works with any plan. The workbook itself
 * sends nothing anywhere.
 */
export function AiPanel({ id, title, answer, tests }: { id: string; title: string; answer: string; tests: PromptRequest['tests'] }) {
  const t = useT();
  const lang = useLang();
  const settings = useSettings().data;
  const save = useSaveSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const [lineCopied, setLineCopied] = useState(false);

  if (!settings) return null;
  const standard = DEFAULT_PROMPT_TEMPLATE[lang];
  const template = draft ?? (settings.aiPromptTemplate || standard);
  const custom = template !== standard;

  /** The default is not stored, so it keeps following the app's language. */
  const storeTemplate = async () => {
    if (draft === null) return;
    const value = draft === standard ? '' : draft;
    if (value !== settings.aiPromptTemplate) await save.mutateAsync({ aiPromptTemplate: value });
    // Shown until it is stored, so the text and the layout around it do not jump. Newer typing stays.
    setDraft((current) => (current === draft ? null : current));
  };

  const copy = async () => {
    setError(null);
    setCopied(null);
    let text: string;
    try {
      await storeTemplate();
      text = (await fetchAiPrompt(id, { answer, tests, lang })).text;
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setPrompt(text);
    try {
      await navigator.clipboard.writeText(text);
      setCopied('yes');
    } catch {
      // Not every browser allows this, for example after the request above.
      setCopied('failed');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-sheet p-5">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-ink-2">{t.aiIntro}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!answer.trim()} onClick={() => void copy()}>
            {copied === 'yes' ? <Check size={15} /> : <Copy size={15} />} {t.aiCopy}
          </Button>
          {CHATS.map(([name, url]) => (
            <a key={name} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              {t.aiOpenChat(name)} <ExternalLink size={13} />
            </a>
          ))}
        </div>
        {!answer.trim() ? <p className="mt-2 text-sm text-ink-3">{t.aiNothing}</p> : null}
        {copied ? (
          <p className={copied === 'yes' ? 'mt-3 text-sm font-medium text-done' : 'mt-3 text-sm font-medium text-danger'} role="status">
            {copied === 'yes' ? t.aiCopied : t.aiCopyFailed}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {prompt !== null ? (
          <details className="mt-3 text-sm" open={copied === 'failed'}>
            <summary className="cursor-pointer font-medium text-ink-2">{t.aiShowPrompt}</summary>
            <textarea readOnly value={prompt} rows={10} aria-label={t.aiShowPrompt} onFocus={(e) => e.target.select()} className="mt-2 w-full resize-y wb-field wb-field-sunk p-3 font-mono text-[12px] leading-relaxed" />
          </details>
        ) : null}
        <p className="mt-3 text-xs text-ink-3">{t.aiCopyNote}</p>

        {settings.assistantBridge ? (
          <div className="mt-5 border-t border-line pt-4 text-sm">
            <p className="text-[13px] text-ink-2">{t.aiBridgeLine}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="min-w-0 flex-1 wb-field wb-field-sunk px-3 py-2 font-mono text-[12px] leading-relaxed">{t.aiBridgeText(title, id)}</code>
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(t.aiBridgeText(title, id)).then(() => {
                    setLineCopied(true);
                    setTimeout(() => setLineCopied(false), 2000);
                  });
                }}
              >
                {lineCopied ? <Check size={15} /> : <Copy size={15} />} {t.aiBridgeCopy}
              </Button>
            </div>
          </div>
        ) : null}

        <details className="mt-6 border-t border-line pt-4 text-sm">
          <summary className="cursor-pointer font-medium text-ink-2">{t.aiEditTemplate}</summary>
          <p className="mt-2 text-[13px] text-ink-2">{t.aiTemplateBody}</p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {PROMPT_PLACEHOLDERS.map((name) => (
              <code key={name} className="rounded border border-line bg-sunk px-1.5 py-0.5 font-mono text-[12px]">{`{${name}}`}</code>
            ))}
          </p>
          <textarea
            value={template}
            rows={14}
            maxLength={20_000}
            spellCheck={false}
            aria-label={t.aiEditTemplate}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void storeTemplate().catch((e: Error) => setError(e.message))}
            className="mt-2 w-full resize-y wb-field p-3 font-mono text-[12px] leading-relaxed"
          />
          {!template.includes('{answer}') ? (
            <p className="mt-1 text-[13px] font-medium text-danger" role="status">
              {t.aiTemplateNoAnswer}
            </p>
          ) : null}
          {custom ? (
            <Button
              size="sm"
              className="mt-2"
              // Keeps the focus in the text, which would otherwise be saved on the way here.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDraft(standard);
                save.mutate({ aiPromptTemplate: '' }, { onSuccess: () => setDraft(null) });
              }}
            >
              {t.aiTemplateReset}
            </Button>
          ) : null}
        </details>
      </div>
    </div>
  );
}
