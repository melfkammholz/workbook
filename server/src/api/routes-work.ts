import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isAnnotationColor, type AchievementsResponse, type HowSolved, type ReviewChecklistEntry, type ReviewData } from '@wb/shared';
import { qualifiesFor } from '../achievements.js';
import { hasTests, sharedOwner } from '../content/loader.js';
import type { Deps } from './deps.js';
import { runChecks } from '../runners/checks.js';
import path from 'node:path';

const status = z.enum(['todo', 'in_progress', 'done', 'review']);
const HOW = ['alone', 'hints', 'solution', 'asked', 'ai'] as const;

const bodies = {
  answer: z.object({ slot: z.string().min(1).max(200), content: z.string().max(500_000), reason: z.enum(['autosave', 'run', 'check', 'done', 'reset', 'restore', 'retry']).default('autosave') }),
  note: z.object({ format: z.enum(['typst', 'markdown']), content: z.string().max(500_000) }),
  status: z.object({ status }),
  tick: z.object({ seconds: z.number().min(0).max(3600) }),
  hints: z.object({ count: z.number().int().min(0).max(100) }),
  question: z.object({ content: z.string().max(2000) }),
  checklistAnswer: z.object({ confidence: z.number().int().min(1).max(5).nullable(), note: z.string().max(4000).default('') }),
  check: z.object({ files: z.record(z.string(), z.string().max(500_000)) }),
  reflection: z.object({
    confidence: z.number().int().min(1).max(5),
    how: z.array(z.enum(HOW)).max(5).default([]),
    comment: z.string().max(2000).default(''),
  }),
  settings: z
    .object({
      displayName: z.string().max(100),
      theme: z.enum(['system', 'light', 'dusk', 'dark']),
      duskColor: z.enum(['indigo', 'teal', 'plum', 'forest']),
      uiLanguage: z.enum(['auto', 'de', 'en']),
      setupDone: z.boolean(),
      noteFormat: z.enum(['typst', 'markdown']),
      showTimer: z.boolean(),
      showLessonOutline: z.boolean(),
      helpAfterMinutes: z.number().int().min(0).max(1440),
      showAchievements: z.boolean(),
      rewards: z.enum(['all', 'zoo']),
      rewardIcon: z.enum(['trophy', 'paw']),
      showFlashcards: z.boolean(),
      showAnnotations: z.boolean(),
      highlightLabels: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().max(60), color: z.string().transform((c) => c.toLowerCase()).refine(isAnnotationColor, 'a palette color or #rrggbb') })).max(30).refine((l) => new Set(l.map((x) => x.color)).size === l.length, 'one label for each color'),
      pdfPageMarks: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().max(60) })).max(30),
      showMaterials: z.boolean(),
      showAi: z.boolean(),
      safeColors: z.boolean(),
      warmPaper: z.boolean(),
      editorFontSize: z.number().min(10).max(24),
      editorKeys: z.enum(['default', 'vim']),
      aiPromptTemplate: z.string().max(20_000),
    })
    .partial(),
};

export function workRoutes(app: FastifyInstance, d: Deps): void {
  /** Parse a body or answer 400. */
  function parse<T extends z.ZodTypeAny>(schema: T, body: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }): z.infer<T> | null {
    const r = schema.safeParse(body);
    if (r.success) return r.data;
    reply.code(400).send({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return null;
  }
  /** The item must exist (and be an exercise for exercise-only routes). */
  const exists = (id: string) => d.content.current.get(id) !== undefined;

  /** What the student wrote for an exercise, including their work in shared files. */
  const answersOf = (id: string): Record<string, string> => {
    const shared = d.content.current.exercise(id)?.code?.shared;
    return { ...d.store.getAnswers(id), ...(shared ? d.store.getAnswers(sharedOwner(shared)) : {}) };
  };

  /** Noted only while it can have helped: looking after finishing says nothing about how it was solved. */
  const viewedAnswer = (id: string) => {
    if (d.store.getProgress(id)?.status !== 'done') d.store.recordSolutionViewed(id);
  };

  app.get<{ Params: { id: string } }>('/api/work/:id', async (req, reply) => {
    const { id } = req.params;
    if (!exists(id)) return reply.code(404).send({ error: 'unknown item' });
    return {
      answers: answersOf(id),
      note: d.store.getNote(id),
      progress: d.store.getProgress(id),
      stats: d.store.getStats(id),
      reflections: d.store.listReflections(id),
      openQuestion: d.store.getState().openQuestions[id] ?? null,
    };
  });

  app.put<{ Params: { id: string } }>('/api/work/:id/answer', async (req, reply) => {
    const b = parse(bodies.answer, req.body, reply);
    if (!b) return;
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'unknown item' });
    d.store.saveAnswer(d.content.current.owner(req.params.id, b.slot), b.slot, b.content, b.reason);
    d.store.noteActivity(req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { slot?: string } }>('/api/work/:id/versions', async (req) =>
    d.store.listVersions(d.content.current.owner(req.params.id, req.query.slot ?? 'text'), req.query.slot ?? 'text'),
  );

  app.put<{ Params: { id: string } }>('/api/work/:id/note', async (req, reply) => {
    const b = parse(bodies.note, req.body, reply);
    if (!b) return;
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'unknown item' });
    d.store.saveNote(req.params.id, b.format, b.content);
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>('/api/progress/:id', async (req, reply) => {
    const b = parse(bodies.status, req.body, reply);
    if (!b) return;
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'unknown item' });
    return d.store.setStatus(req.params.id, b.status);
  });

  app.put<{ Params: { id: string } }>('/api/work/:id/question', async (req, reply) => {
    const b = parse(bodies.question, req.body, reply);
    if (!b) return;
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'unknown item' });
    d.store.saveOpenQuestion(req.params.id, b.content);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/work/:id/open', async (req, reply) => {
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'unknown item' });
    d.store.recordOpen(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/work/:id/tick', async (req, reply) => {
    const b = parse(bodies.tick, req.body, reply);
    if (!b) return;
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'unknown item' });
    d.store.addActiveSeconds(req.params.id, b.seconds);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/work/:id/timer/reset', async (req, reply) => {
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'unknown item' });
    d.store.resetActiveTime(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/work/:id/hints', async (req, reply) => {
    const b = parse(bodies.hints, req.body, reply);
    if (!b) return;
    d.store.recordHints(req.params.id, b.count);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/work/:id/solution', async (req, reply) => {
    const ex = d.content.current.exercise(req.params.id);
    if (!ex?.code || Object.keys(ex.code.reveal).length === 0) return reply.code(404).send({ error: 'this exercise has no solution' });
    viewedAnswer(req.params.id);
    return { files: ex.code.reveal };
  });

  app.post<{ Params: { id: string } }>('/api/work/:id/sample', async (req, reply) => {
    const ex = d.content.current.exercise(req.params.id);
    if (!ex?.meta.hasSample) return reply.code(404).send({ error: 'this exercise has no sample answer' });
    const rendered = await d.renderer.renderItem(ex);
    viewedAnswer(req.params.id);
    return { samples: rendered.samples, css: rendered.css };
  });

  /** Test runs in progress, by exercise, so that the student can stop them. */
  const running = new Map<string, Set<AbortController>>();

  app.post<{ Params: { id: string } }>('/api/work/:id/check/stop', async (req) => {
    for (const c of running.get(req.params.id) ?? []) c.abort();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/work/:id/check', async (req, reply) => {
    const b = parse(bodies.check, req.body, reply);
    if (!b) return;
    const ex = d.content.current.exercise(req.params.id);
    if (!ex?.code || !hasTests(ex.code)) return reply.code(404).send({ error: 'this exercise has no tests' });
    // Only the files the exercise declares are accepted, nothing else gets written.
    const files: Record<string, string> = {};
    for (const file of Object.keys(ex.code.files)) {
      const content = b.files[file];
      if (content === undefined) return reply.code(400).send({ error: `missing file ${file}` });
      files[file] = content;
    }

    const controller = new AbortController();
    const runs = running.get(ex.meta.id) ?? new Set();
    running.set(ex.meta.id, runs.add(controller));
    let run;
    try {
      run = await runChecks({
        runghcBin: d.config.runghcBin,
        swiplBin: d.config.swiplBin,
        sldcheckBin: d.config.sldcheckBin,
        haskellLib: d.haskellLib,
        prologLib: d.prologLib,
        workDir: path.join(d.config.dataDir, 'runs'),
        code: ex.code,
        files,
        signal: controller.signal,
      });
    } finally {
      runs.delete(controller);
      if (runs.size === 0) running.delete(ex.meta.id);
    }
    for (const [file, content] of Object.entries(files)) d.store.saveAnswer(d.content.current.owner(ex.meta.id, file), file, content, 'check');
    d.store.noteActivity(ex.meta.id);
    if (run.compiled && !run.runnerError && !run.stopped && run.results.length > 0)
      d.store.recordCheckRun(ex.meta.id, run.results.filter((r) => r.status === 'pass').length, run.results.length);
    return run;
  });

  app.post<{ Params: { id: string } }>('/api/work/:id/reflection', async (req, reply) => {
    const b = parse(bodies.reflection, req.body, reply);
    if (!b) return;
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'unknown item' });
    return d.store.addReflection(req.params.id, b.confidence, b.how as HowSolved[], b.comment);
  });

  app.put<{ Params: { id: string; question: string } }>('/api/checklists/:id/:question', async (req, reply) => {
    const b = parse(bodies.checklistAnswer, req.body, reply);
    if (!b) return;
    if (d.content.current.get(req.params.id)?.meta.type !== 'checklist') return reply.code(404).send({ error: 'unknown checklist' });
    d.store.saveChecklistAnswer(req.params.id, req.params.question, b.confidence, b.note);
    return { ok: true };
  });

  // Settings belong to the student, whichever course is open.
  app.get('/api/settings', async () => d.courses.global.getSettings());

  app.put('/api/settings', async (req, reply) => {
    const b = parse(bodies.settings, req.body, reply);
    if (!b) return;
    return d.courses.global.saveSettings(b);
  });

  app.get('/api/achievements', async (): Promise<AchievementsResponse> => {
    // While switched off, nothing is worked out and nothing is earned.
    if (!d.courses.global.getSettings().showAchievements) return { earned: [], unseen: [] };
    d.store.syncAchievements(
      qualifiesFor({
        outline: d.content.current.outline,
        state: d.store.getState(),
        reflections: d.store.listReflections(),
        checklistRatings: d.store.listChecklistRatings(),
        noteCount: d.store.noteCount(),
        resolvedMarks: d.store.resolvedMarkCount(),
      }),
    );
    // In the order they were earned, so the second of a kind is the one that finds a friend.
    const animals = new Set<string>();
    const all = d.store.listAchievements().map((a) => {
      if (a.event.kind !== 'animal') return a;
      const friend = animals.has(a.event.emoji);
      animals.add(a.event.emoji);
      return { ...a, event: { ...a.event, friend } };
    });
    const plain = ({ key, earnedAt, event }: (typeof all)[number]) => ({ key, earnedAt, event });
    return { earned: all.map(plain), unseen: all.filter((a) => !a.seen).map(plain) };
  });

  app.post('/api/achievements/seen', async () => {
    d.store.markAchievementsSeen();
    return { ok: true };
  });

  app.get('/api/review', async (): Promise<ReviewData> => {
    const base = d.store.reviewData();
    const content = d.content.current;
    // Shared work shows under each exercise that uses it.
    const answers = { ...base.answers };
    for (const item of content.all()) if (item.meta.type === 'exercise' && Object.keys(answersOf(item.meta.id)).length) answers[item.meta.id] = answersOf(item.meta.id);

    const checklists: ReviewChecklistEntry[] = [];
    for (const [checklistId, given] of Object.entries(d.store.getState().checklists)) {
      const item = content.get(checklistId);
      if (item?.meta.type !== 'checklist') continue;
      // A question that was reworded since has no text to show, so its old answer stays out of this.
      for (const question of (await d.renderer.renderItem(item)).questions) {
        const answer = given[question.id];
        if (answer) checklists.push({ checklistId, title: item.meta.title, question, answer });
      }
    }
    return { ...base, answers, checklists };
  });
}
