import crypto from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { QUESTION_KINDS, locateQuote, quoteAt, type Anchor, type CardKind, type Question, type QuestionKind, type TextQuote } from '@wb/shared';
import { hasTests, sharedOwner } from '../content/loader.js';
import { plainText } from '../content/search.js';
import { runChecks } from '../runners/checks.js';
import { searchEverything } from '../courses/search.js';
import type { Deps } from './deps.js';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_TEXT = 12_000;

type Json = Record<string, unknown>;
class ToolError extends Error {}

const TOOLS = [
  {
    name: 'list_questions',
    description: "The student's open questions (newest first), with where each was asked. Filters are all optional.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done'] },
        course: { type: 'string', description: 'Workbook id' },
        resource: { type: 'string', description: 'Material id' },
        pass: { type: 'integer', description: 'Pass id: questions captured in one sitting' },
        limit: { type: 'integer', description: 'Default 50' },
      },
    },
  },
  {
    name: 'search',
    description: "Full-text search over workbook texts, the student's own text (notes, answers, highlights, questions) and materials' pages. Every result says where it is (href, material and page).",
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'read_page',
    description: 'The text of one page (1-based) of a material, or of one workbook item (exercise, lesson, page). Solutions, hints and author notes only if the student allows it; hint, do not reveal unless asked.',
    inputSchema: {
      type: 'object',
      properties: { resource: { type: 'string' }, page: { type: 'integer' }, item: { type: 'string' }, course: { type: 'string', description: 'Workbook id, if the item id is not unique' } },
    },
  },
  {
    name: 'get_context',
    description: 'A question with its surroundings: the page of a material (with the pages around it) or the item it was asked about, with a marker where it was asked. Hints and author notes are included only if the student allows it; hint, do not reveal unless asked.',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
  {
    name: 'get_exercise_work',
    description: "One exercise as the student left it: the task text, their saved code (every file), and how their last test run went (a count; run_tests gives details). Read-only. Never propose changes to exercise code; explain, and hint rather than reveal.",
    inputSchema: { type: 'object', properties: { exercise: { type: 'string' }, course: { type: 'string', description: 'Workbook id, if the exercise id is not unique' } }, required: ['exercise'] },
  },
  {
    name: 'run_tests',
    description: "Runs the exercise's tests on the code the student has saved (never on code you write) and returns each test's result. Nothing is saved or counted as the student's attempt.",
    inputSchema: { type: 'object', properties: { exercise: { type: 'string' }, course: { type: 'string' } }, required: ['exercise'] },
  },
  {
    name: 'get_progress',
    description: "A compact overview of the student's work: items done or marked for review, their own self-ratings (1 to 5), time and test runs, and flashcard reviews of the last 30 days. Only if the student allows it. It is context, never a judgement: do not rank, grade or praise by numbers.",
    inputSchema: { type: 'object', properties: { course: { type: 'string', description: 'Workbook id; default all' } } },
  },
  { name: 'list_digests', description: 'Your own saved digests (your memory, per material or workbook).', inputSchema: { type: 'object', properties: { resource: { type: 'string' }, course: { type: 'string' } } } },
  { name: 'list_labels', description: "The student's own labels (topics). Reuse these names in propose before inventing new ones.", inputSchema: { type: 'object', properties: {} } },
  {
    name: 'propose',
    description: `Propose changes to ONE question; they wait in the student's inbox and change nothing until accepted. Give any of: type (one of ${QUESTION_KINDS.join(', ')}; null clears), labels (names to add; a name that is new becomes a label, so prefer existing ones), answer (a short answer; accepting it closes the question), text (a clearer rewording of the question itself; the student sees the original next to it and can undo, so keep the meaning), reason (one line). Never re-propose what was rejected: read list_proposals first.`,
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string' }, type: { type: ['string', 'null'], enum: [...QUESTION_KINDS, null] }, labels: { type: 'array', items: { type: 'string' } }, answer: { type: 'string' }, text: { type: 'string' }, reason: { type: 'string' } },
      required: ['question'],
    },
  },
  { name: 'list_decks', description: "The titles of the student's flashcard decks. Put a card into one of these by title before inventing a new deck.", inputSchema: { type: 'object', properties: {} } },
  {
    name: 'propose_card',
    description: `Propose ONE flashcard; it waits in the student's inbox and changes nothing until accepted (they can edit it and pick the deck). front and back are Typst text (code in backticks); one idea per card, ground it in the text. kind "cloze" needs only front with gaps written {{like this}}. deck is a title: an existing deck's (see list_decks) or a new one. Point at where it comes from with resource + page (+ quote) or item (+ course), so the card links back to it. Never re-propose what was rejected: read list_proposals first.`,
    inputSchema: { type: 'object', properties: { front: { type: 'string' }, back: { type: 'string' }, kind: { type: 'string', enum: ['basic', 'both', 'cloze'], description: 'Default basic; both = also asked backwards' }, deck: { type: 'string' }, resource: { type: 'string', description: 'Material id' }, page: { type: 'integer', description: 'Page of the material, 1-based' }, quote: { type: 'string', description: 'Words of that page, copied exactly' }, item: { type: 'string', description: 'Or a workbook item id' }, course: { type: 'string', description: 'Workbook id, if the item id is not unique' }, reason: { type: 'string' } }, required: ['front', 'deck'] },
  },
  {
    name: 'propose_highlight',
    description: `Propose marking a passage of a material with a note; it waits in the inbox and, once accepted, becomes a note on that page quoting the passage. quote must be words of that page, copied exactly (read_page first).`,
    inputSchema: { type: 'object', properties: { resource: { type: 'string' }, page: { type: 'integer', description: '1-based' }, quote: { type: 'string' }, note: { type: 'string' }, reason: { type: 'string' } }, required: ['resource', 'page', 'quote'] },
  },
  {
    name: 'propose_question',
    description: `Propose a NEW question the student might ask ("you might ask: ..."), about a place in a material (resource + page + quote) or a workbook item (item + course). It waits in the inbox, marked as yours, and becomes an open question if accepted. Do not answer it yourself here; for answers use propose on an existing question.`,
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, resource: { type: 'string', description: 'Material id' }, page: { type: 'integer', description: 'Page of the material, 1-based' }, quote: { type: 'string', description: 'Words of that page, copied exactly' }, item: { type: 'string', description: 'Or a workbook item id' }, course: { type: 'string', description: 'Workbook id, if the item id is not unique' }, reason: { type: 'string' } }, required: ['text'] },
  },
  { name: 'list_proposals', description: 'Your proposals: waiting, applied, rejected (with what the student told you) and expired.', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'applied', 'rejected', 'expired', 'undone'] } } } },
  {
    name: 'write_digest',
    description: 'Save or replace a digest for yourself (for example a summary of a material). The student can read and delete it in settings. It changes nothing else.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Replaces this digest' }, title: { type: 'string' }, content: { type: 'string' }, resource: { type: 'string' }, course: { type: 'string' } },
      required: ['title', 'content'],
    },
  },
];

const PROMPTS = [
  {
    name: 'triage-questions',
    description: "Go through the student's new open questions and propose a type and labels for each.",
    arguments: [{ name: 'pass', description: 'Only the questions of this pass id', required: false }],
    text: (a: Json) =>
      `Triage the student's open questions in their workbook. First call list_proposals (do not repeat what was rejected) and list_labels (reuse existing names). Then call list_questions with status "open"${str(a.pass) ? ` and pass ${str(a.pass)}` : ''}, skipping questions that already have a type and labels. Where the wording is unclear, read get_context. For each question call propose with a type, labels and a one-line reason. Do not answer questions in this pass, and do not close anything. Finish with a short list of what you proposed.`,
  },
  {
    name: 'answer-pass',
    description: 'Propose short answers for the questions of one pass, from the text they were asked about.',
    arguments: [{ name: 'pass', description: 'Pass id (see list_questions)', required: true }],
    text: (a: Json) =>
      `Answer the questions of pass ${str(a.pass) ?? '(ask the student which pass)'} in the student's workbook. Read list_proposals first. For each open question from list_questions, read get_context and, if needed, search or read_page. Then propose an answer: short, in the student's language, grounded in the text they were reading, saying where in it. If the text does not answer it, say so in the reason instead of guessing. Do not reveal solutions of exercises unless the question asks for one. Summarize what you proposed.`,
  },
  {
    name: 'draft-flashcards',
    description: 'Propose flashcards from a material or from the questions the student asked; they decide in their inbox.',
    arguments: [{ name: 'resource', description: 'Material id; default: the open questions', required: false }],
    text: (a: Json) =>
      `Propose flashcards for the student${str(a.resource) ? ` from the material ${str(a.resource)} (read it with read_page, page by page)` : ' from their open questions (list_questions, get_context)'}. First call list_proposals (do not repeat what was rejected) and list_decks (use an existing deck's title where the topic fits). Then call propose_card once per card: one idea per card, a clear front, a short back, and where it comes from (resource + page + an exact quote, or item). Cards you cannot ground in the text are left out. You cannot create cards yourself: the student accepts, edits or rejects each one in their inbox. Finish with a short list of what you proposed.`,
  },
  {
    name: 'review-exercise',
    description: "Review one exercise from the student's own saved work, with hints instead of the solution.",
    arguments: [
      { name: 'exercise', description: 'Exercise id', required: true },
      { name: 'course', description: 'Workbook id, if the exercise id is not unique', required: false },
    ],
    text: (a: Json) =>
      `Review the exercise "${str(a.exercise) ?? '(ask the student which one)'}" from the student's workbook${str(a.course) ? ` (workbook ${str(a.course)})` : ''}. Call get_exercise_work, then run_tests on their saved code. Say what works, find where the code and the tests disagree, and explain why. Give hints and questions that lead the student to the fix, not corrected code or the reference solution, unless they ask for it. You cannot change their code and must not propose changes to it.`,
  },
];

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const cut = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n… (cut, ${s.length - MAX_TEXT} more characters)` : s);

/** `POST /mcp`: a read-only assistant bridge, stateless Streamable HTTP with JSON answers. Off unless the student turned it on. */
export function mcpRoutes(app: FastifyInstance, d: Deps): void {
  const g = () => d.courses.global;
  const digest = (s: string) => crypto.createHash('sha256').update(s).digest();

  /** A new token; the old one stops working. */
  const newToken = () => g().saveSettings({ bridgeToken: crypto.randomBytes(24).toString('base64url') });

  app.post('/api/bridge/token', async () => newToken());
  app.get('/api/bridge/digests', async () => g().listDigests());
  app.delete<{ Params: { id: string } }>('/api/bridge/digests/:id', async (req, reply) => (g().deleteDigest(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'unknown digest' })));

  const filed = (r: { id: string } | { error: string }) => {
    if ('error' in r) throw new ToolError(r.error);
    return { filed: 1, note: 'waiting in the inbox until the student decides' };
  };

  /** A place the assistant names (page of a material with an exact quote, or a workbook item) as an anchor; throws if it is not there. */
  const anchorOf = (a: Json): Anchor => {
    const resource = str(a.resource);
    if (resource) {
      const page = int(a.page);
      if (!page || page < 1) throw new ToolError('page is required (1-based)');
      let res;
      try {
        res = d.courses.resources.get(resource);
      } catch {
        throw new ToolError('unknown material');
      }
      const fp = g().sql.get('SELECT fingerprint FROM pdf_pages WHERE resource = ? AND page_index = ? AND unplaced = 0', resource, page - 1);
      const base = { kind: 'page' as const, resource, version: res.file.sha256, pageIndex: page - 1, fingerprint: (fp?.fingerprint as string | undefined) ?? '' };
      const quote = str(a.quote);
      if (!quote) return base;
      const text = g().resourcePageText(resource, page - 1);
      if (text === null) throw new ToolError(`the text of page ${page} is not available (not read yet?); try again in a minute`);
      const at = locateQuote(text, { quote, prefix: '', suffix: '' });
      const q = at ? quoteAt(text, at.start, at.end) : null;
      if (!q) throw new ToolError(`the quote is not on page ${page}: copy words of the page exactly (read_page)`);
      return { ...base, ...q };
    }
    const item = str(a.item);
    if (!item) throw new ToolError('say where: resource + page, or item');
    const found = findItem(item, str(a.course));
    if (!found) throw new ToolError(`unknown item "${item}"`);
    const course = found.s.content.outline.id;
    return found.s.content.exercise(item) ? { kind: 'exercise', course, id: item } : { kind: 'item', course, id: item };
  };

  const where = (q: Question): string => {
    const a = q.anchor;
    switch (a.kind) {
      case 'exercise':
      case 'item':
        return `${a.kind} ${a.id} (workbook ${a.course})`;
      case 'text':
        return `text of ${a.target} (workbook ${a.course}): "${a.quote}"`;
      case 'page':
        return `material ${a.resource}, page ${a.pageIndex + 1}${a.quote ? `: "${a.quote}"` : ''}`;
      case 'material':
        return `material ${a.resource}`;
      default:
        return 'nowhere in particular';
    }
  };

  const findItem = (id: string, course?: string) => {
    for (const s of d.courses.searchScope()) {
      if (course && s.id !== course && s.key !== course) continue;
      const item = s.content.get(id);
      if (item) return { s, item };
    }
    return null;
  };

  /** The exercise with the store that holds the work of its workbook. */
  const exerciseOf = (id: string | undefined, course?: string) => {
    if (!id) throw new ToolError('exercise is required');
    const found = findItem(id, course);
    const ex = found?.s.content.exercise(id);
    if (!found || !ex?.code) throw new ToolError(`"${id}" is not a programming exercise`);
    return { ...found, ex, code: ex.code, store: g().forCourse(found.s.key) };
  };

  const savedFiles = (e: ReturnType<typeof exerciseOf>): Record<string, string> => {
    const shared = e.code.shared;
    const saved = { ...e.store.getAnswers(e.ex.meta.id), ...(shared ? e.store.getAnswers(sharedOwner(shared)) : {}) };
    return Object.fromEntries(Object.keys(e.code.files).map((f) => [f, saved[f] ?? e.code.files[f]!]));
  };

  const lastRun = (e: ReturnType<typeof exerciseOf>) => {
    const r = e.store.sql.get('SELECT at, passed, total FROM check_history WHERE course = ? AND exercise_id = ? ORDER BY id DESC LIMIT 1', e.store.course, e.ex.meta.id);
    return r ? { at: new Date(Number(r.at)).toISOString(), passed: Number(r.passed), total: Number(r.total) } : null;
  };

  const MARK = '⟦the student asked their question here⟧';
  /** Puts the marker after the quoted place, or says that the place could not be found in this text. */
  const mark = (text: string, quote: TextQuote | undefined): { text: string; found: boolean } => {
    if (!quote) return { text, found: false };
    const at = locateQuote(text, quote);
    return at ? { text: `${text.slice(0, at.end)} ${MARK} ${text.slice(at.end)}`, found: true } : { text, found: false };
  };

  const itemText = (id: string, course?: string, quote?: TextQuote): string => {
    const found = findItem(id, course);
    if (!found) throw new ToolError(`unknown item "${id}"`);
    const { item } = found;
    const full = g().getSettings().bridgeIncludeSolutions;
    const plain = plainText(item.typst);
    let marked = mark(full ? item.typst : plain, quote);
    // A quote comes from the rendered text, so in the Typst source it often cannot be found: then the marked plain text goes first.
    const seen = full && quote && !marked.found ? mark(plain, quote) : null;
    if (seen?.found) marked = { found: true, text: marked.text };
    const note = quote ? (marked.found ? `The marker ${MARK} shows where the question was asked.` : `The question was asked at "${quote.quote}", which could not be located in this text.`) : 'The question was asked about the whole item.';
    let out = full
      ? `# ${item.meta.title}\n\n${note}\nIncluded: hints, author notes and solutions (the student allows it). Do not reveal them unless the student asks.\n\n${seen?.found ? `Text as the student saw it:\n\n${seen.text}\n\n` : ''}Source (Typst):\n\n${marked.text}`
      : `# ${item.meta.title}\n\n${note}\nHints, author notes and solutions are left out (the student's setting).\n\n${marked.text}`;
    const code = full && 'code' in item ? item.code : null;
    if (code) for (const [file, text] of Object.entries(code.fullSolution)) out += `\n\nSolution, ${file}:\n\n${text}`;
    return out;
  };

  const pageText = (resource: string, page: number): string => {
    try {
      d.courses.resources.get(resource);
    } catch {
      throw new ToolError(`unknown material "${resource}"`);
    }
    const t = g().resourcePageText(resource, page - 1);
    if (t === null) throw new ToolError(`no text for page ${page} of "${resource}" (empty, out of range, or not read yet)`);
    return t;
  };

  const call = async (name: string, a: Json): Promise<unknown> => {
    switch (name) {
      case 'list_questions': {
        const course = str(a.course);
        const resource = str(a.resource);
        const pass = int(a.pass);
        const status = str(a.status);
        const qs = g()
          .listQuestions({ ...(course ? { course } : {}), ...(resource ? { resource } : {}) })
          .filter((q) => (!status || q.status === status) && (pass === undefined || q.passId === pass))
          .sort((x, y) => y.createdAt - x.createdAt)
          .slice(0, Math.min(int(a.limit) ?? 50, 200));
        const names = new Map(g().listLabels('any').map((l) => [l.id, l.name]));
        return qs.map((q) => ({ id: q.id, text: q.text, status: q.status, answer: q.answer, type: q.kind, labels: q.labels.flatMap((l) => (names.has(l) ? [names.get(l)!] : [])), where: where(q), pass: q.passId, created: new Date(q.createdAt).toISOString() }));
      }
      case 'search': {
        const query = str(a.query);
        if (!query) throw new ToolError('query is required');
        const r = searchEverything(d.courses, query);
        return {
          workbooks: r.items.map((i) => ({ item: i.id, title: i.title, workbook: i.course, snippet: i.snippet })),
          mine: r.mine.map((m) => ({ source: m.source, title: m.title, snippet: m.snippet, href: m.href })),
          materials: r.materials.map((m) => ({ resource: m.resource, title: m.title, page: m.page, snippet: m.snippet })),
        };
      }
      case 'read_page': {
        const resource = str(a.resource);
        const item = str(a.item);
        if (resource) {
          const page = int(a.page);
          if (page === undefined || page < 1) throw new ToolError('page (1-based) is required with resource');
          return cut(pageText(resource, page));
        }
        if (item) return cut(itemText(item, str(a.course)));
        throw new ToolError('give resource and page, or item');
      }
      case 'get_exercise_work': {
        const e = exerciseOf(str(a.exercise), str(a.course));
        const saved = e.store.getAnswers(e.ex.meta.id);
        const files = savedFiles(e);
        return {
          exercise: e.ex.meta.id,
          title: e.ex.meta.title,
          language: e.code.language,
          task: cut(itemText(e.ex.meta.id, str(a.course))),
          code: files,
          note: Object.keys(saved).length ? undefined : 'The student has saved no code yet; this is the starter.',
          lastTestRun: lastRun(e) ?? 'not run yet',
          hasTests: hasTests(e.code),
        };
      }
      case 'run_tests': {
        const e = exerciseOf(str(a.exercise), str(a.course));
        if (!hasTests(e.code)) throw new ToolError('this exercise has no tests');
        if (!Object.keys(e.store.getAnswers(e.ex.meta.id)).length) throw new ToolError('the student has saved no code for this exercise yet');
        const run = await runChecks({
          runghcBin: d.config.runghcBin,
          swiplBin: d.config.swiplBin,
          sldcheckBin: d.config.sldcheckBin,
          haskellLib: d.haskellLib,
          prologLib: d.prologLib,
          workDir: path.join(d.config.dataDir, 'runs'),
          code: e.code,
          files: savedFiles(e),
        });
        return {
          compiled: run.compiled,
          diagnostics: run.diagnostics,
          results: run.results.map((r) => ({ name: r.name, status: r.status, message: r.message })),
          stdout: cut(run.stdout),
          runnerError: run.runnerError,
        };
      }
      case 'get_progress': {
        if (!g().getSettings().bridgeIncludeProgress) throw new ToolError("the student does not share their progress through the bridge (setting)");
        const course = str(a.course);
        const workbooks = d.courses
          .searchScope()
          .filter((s) => !course || s.id === course || s.key === course)
          .map((s) => {
            const st = g().forCourse(s.key).getState();
            const title = (id: string) => s.content.get(id)?.meta.title ?? id;
            const entries = Object.entries(st.progress);
            return {
              workbook: s.id,
              title: s.title,
              done: entries.filter(([, p]) => p.status === 'done').map(([id]) => title(id)),
              reviewLater: entries.filter(([, p]) => p.status === 'review').map(([id]) => title(id)),
              selfRating: Object.fromEntries(Object.entries(st.reflections).map(([id, r]) => [title(id), r.confidence])),
              work: Object.fromEntries(Object.entries(st.stats).filter(([, x]) => x.activeSeconds || x.checkRuns).map(([id, x]) => [title(id), { minutes: Math.round(x.activeSeconds / 60), testRuns: x.checkRuns, runsAllPassed: x.checkPasses }])),
            };
          });
        const since = Date.now() - 30 * 86_400_000;
        const cards = g().sql.all('SELECT deck_id, COUNT(*) AS n, ROUND(AVG(rating), 1) AS avg FROM card_reviews WHERE reviewed_at >= ? GROUP BY deck_id', since);
        return { note: 'Context only, not a judgement. Self-ratings are the student\'s own, 1 (lost) to 5 (could teach it).', workbooks, cardReviewsLast30Days: cards.map((r) => ({ deck: r.deck_id, reviews: Number(r.n), averageRating: Number(r.avg) })) };
      }
      case 'get_context': {
        const id = str(a.question);
        const q = id ? g().getQuestion(id) : null;
        if (!q) throw new ToolError('unknown question');
        const an = q.anchor;
        const out: Json = { question: { id: q.id, text: q.text, status: q.status, answer: q.answer, where: where(q) } };
        if (an.kind === 'page') {
          const pages: Json = {};
          for (const p of [an.pageIndex - 1, an.pageIndex, an.pageIndex + 1]) {
            const t = p >= 0 ? g().resourcePageText(an.resource, p) : null;
            if (t) pages[`page ${p + 1}`] = cut(p === an.pageIndex && an.quote ? mark(t, an as TextQuote).text : t);
          }
          out.pages = pages;
          if (!pages[`page ${an.pageIndex + 1}`]) out.note = `The text of page ${an.pageIndex + 1} of "${an.resource}" is not available: it has not been read yet (PDF text is read in the background), is empty, or the file was replaced since the question. Try again in a minute.`;
          else if (an.quote) out.note = `The marker ${MARK} shows where the question was asked.`;
        } else if (an.kind === 'exercise' || an.kind === 'item' || an.kind === 'text') {
          const itemId = an.kind === 'text' ? an.target : an.id;
          try {
            out.item = cut(itemText(itemId, an.course, an.kind === 'text' ? an : undefined));
          } catch {
            /* the item may be gone */
          }
        }
        return out;
      }
      case 'list_digests': {
        const resource = str(a.resource);
        const course = str(a.course);
        return g()
          .listDigests()
          .filter((x) => (!resource || x.resource === resource) && (!course || x.course === course))
          .map((x) => ({ ...x, updatedAt: new Date(x.updatedAt).toISOString() }));
      }
      case 'list_labels':
        return g().listLabels('any').map((l) => l.name);
      case 'propose': {
        const q = str(a.question);
        if (!q) throw new ToolError('question is required');
        const type = a.type === null ? null : str(a.type);
        if (type && !(QUESTION_KINDS as readonly string[]).includes(type)) throw new ToolError(`type must be one of ${QUESTION_KINDS.join(', ')}`);
        const labels = Array.isArray(a.labels) ? a.labels.filter((x): x is string => typeof x === 'string') : undefined;
        const r = g().propose('assistant', q, {
          ...(type !== undefined ? { kind: type as QuestionKind | null } : {}),
          ...(labels ? { labels } : {}),
          ...(typeof a.answer === 'string' ? { answer: a.answer } : {}),
          ...(typeof a.text === 'string' ? { text: a.text } : {}),
          ...(typeof a.reason === 'string' ? { reason: a.reason } : {}),
        });
        if ('error' in r) throw new ToolError(r.error);
        return { filed: r.ids.length, note: 'waiting in the inbox until the student decides' };
      }
      case 'list_decks':
        return d.courses.flashcards.deckTitles();
      case 'propose_card': {
        const front = str(a.front);
        const deck = str(a.deck);
        if (!front || !deck) throw new ToolError('front and deck are required');
        const kind = (str(a.kind) ?? 'basic') as CardKind;
        if (!['basic', 'both', 'cloze'].includes(kind)) throw new ToolError('kind must be basic, both or cloze');
        const back = str(a.back) ?? '';
        if (kind !== 'cloze' && !back) throw new ToolError('back is required (except for cloze)');
        const anchor = a.resource || a.item ? anchorOf(a) : null;
        return filed(g().proposeCreate('assistant', 'card', { deck: { title: deck }, cardKind: kind, front, back, anchor }, str(a.reason)));
      }
      case 'propose_highlight': {
        const resource = str(a.resource);
        const page = int(a.page);
        const quote = str(a.quote);
        if (!resource || !page || !quote) throw new ToolError('resource, page and quote are required');
        const an = anchorOf(a);
        if (an.kind !== 'page' || !an.quote) throw new ToolError('quote is required');
        return filed(g().proposeCreate('assistant', 'highlight', { resource, pageIndex: page - 1, quote: an.quote, note: str(a.note) ?? '' }, str(a.reason)));
      }
      case 'propose_question': {
        const text = str(a.text);
        if (!text) throw new ToolError('text is required');
        return filed(g().proposeCreate('assistant', 'question', { text, anchor: anchorOf(a) }, str(a.reason)));
      }
      case 'list_proposals': {
        const status = str(a.status);
        return g()
          .listChanges({ limit: 100 })
          .filter((c) => !status || c.status === status)
          .map((c) => ({ ...(c.field === 'create' ? { creates: c.ref.kind } : { question: c.ref.id }), field: c.field, before: c.field === 'create' ? undefined : c.before, after: c.after, status: c.status, reason: c.reason, studentSaid: c.feedback }));
      }
      case 'write_digest': {
        const title = str(a.title);
        const content = typeof a.content === 'string' ? a.content : undefined;
        if (!title || content === undefined) throw new ToolError('title and content are required');
        if (content.length > 100_000) throw new ToolError('content is too long (100000 characters at most)');
        return { id: g().writeDigest({ ...(str(a.id) ? { id: str(a.id)! } : {}), title, content, resource: str(a.resource) ?? null, course: str(a.course) ?? null }) };
      }
      default:
        throw new ToolError(`unknown tool "${name}"`);
    }
  };

  const handle = async (m: Json): Promise<Json | null> => {
    const id = m.id as string | number | null | undefined;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
    if (id === undefined) return null; // a notification
    const params = (m.params ?? {}) as Json;
    switch (m.method) {
      case 'initialize': {
        const asked = str(params.protocolVersion);
        return ok({
          protocolVersion: asked && PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: 'workbook', version: '1' },
          instructions: "The student's workbook: their open questions, their own text and the text of their materials. You cannot change anything yourself: propose changes (type, labels, answers) or new things (cards, page notes, questions) and the student decides in their inbox. Read list_proposals first so you do not repeat a rejected one. For exercises you can read the student's saved work and run their tests, but you never propose changes to their code. You may also keep your own digests.",
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: TOOLS });
      case 'prompts/list':
        return ok({ prompts: PROMPTS.map(({ name, description, arguments: args }) => ({ name, description, arguments: args })) });
      case 'prompts/get': {
        const p = PROMPTS.find((x) => x.name === params.name);
        if (!p) return error(-32602, `unknown prompt "${String(params.name)}"`);
        const args = (params.arguments ?? {}) as Json;
        const missing = p.arguments.find((x) => x.required && !str(args[x.name]));
        if (missing) return error(-32602, `${missing.name} is required`);
        return ok({ description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.text(args) } }] });
      }
      case 'tools/call':
        try {
          const text = await call(String(params.name), (params.arguments ?? {}) as Json);
          return ok({ content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text, null, 1) }] });
        } catch (e) {
          if (e instanceof ToolError) return ok({ isError: true, content: [{ type: 'text', text: e.message }] });
          throw e;
        }
      default:
        return error(-32601, `method not found: ${String(m.method)}`);
    }
  };

  app.get('/mcp', async (_req, reply) => reply.code(405).header('allow', 'POST').send({ error: 'POST only' }));
  app.post('/mcp', async (req, reply) => {
    const s = g().getSettings();
    if (!s.showAi || !s.assistantBridge || !s.bridgeToken) return reply.code(404).send({ error: 'not found' });
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!m || !crypto.timingSafeEqual(digest(m[1]!), digest(s.bridgeToken))) return reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'unauthorized' });
    const body = req.body as unknown;
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.flatMap((x) => (x && typeof x === 'object' ? [handle(x as Json)] : [])))).filter((x): x is Json => x !== null);
      return out.length ? out : reply.code(202).send();
    }
    if (!body || typeof body !== 'object') return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    const out = await handle(body as Json);
    return out ?? reply.code(202).send();
  });
}
