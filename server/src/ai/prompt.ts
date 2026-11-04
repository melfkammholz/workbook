import { DEFAULT_PROMPT_TEMPLATE, type CheckResult } from '@wb/shared';

export interface PromptInput {
  title: string;
  /** Plain text of the exercise: the task only, never hints, author notes or the reference solution. */
  task: string;
  answer: string;
  /** Language of a code answer; null for text. */
  language: string | null;
  tests: Pick<CheckResult, 'name' | 'status' | 'message'>[] | null;
  /** Language of the default template. */
  lang: 'de' | 'en';
}

const NO_TESTS = { en: 'No test run yet.', de: 'Noch kein Testlauf.' };

function testLines(i: PromptInput): string {
  if (!i.tests?.length) return NO_TESTS[i.lang];
  return i.tests.map((t) => `${t.status}: ${t.name}${t.message ? `\n  ${t.message.replaceAll('\n', '\n  ')}` : ''}`).join('\n');
}

/**
 * The text a student pastes into their own chat. Replaced in one pass, so whatever
 * a student's answer contains, even `{task}`, stays as it is. Unknown placeholders
 * are left alone: the braces may be part of the student's own wording.
 */
export function buildPrompt(template: string, i: PromptInput): string {
  const values: Record<string, string> = { title: i.title, task: i.task, language: i.language ?? 'text', answer: i.answer, tests: testLines(i) };
  const source = template.trim() ? template : DEFAULT_PROMPT_TEMPLATE[i.lang];
  return source.replace(/\{(title|task|language|answer|tests)\}/g, (_, name: string) => values[name]!);
}
