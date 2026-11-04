import { z } from 'zod';
import { ID_PATTERN } from './ids.js';

const id = z.string().regex(ID_PATTERN, 'ids are lowercase letters, digits and dashes (e.g. "binary-exponentiation")');
const runnable = z.enum(['haskell', 'prolog']);
/** Any lowercase language name. Only `runnable` ones get an interpreter and tests. */
const language = z.string().regex(/^[a-z][a-z0-9+#-]*$/, 'a language name in lowercase, e.g. "haskell" or "python"');

export const codeSchema = z
  .object({
    language: language.optional(),
    /** Work in the files of this adventure or thread instead of a file of its own. */
    shared: id.optional(),
    /**
     * Reference source. May contain `#ifdef TEMPLATE … #else … #endif` to hold starter and solution together.
     * Optional: without it the student starts from an empty file.
     */
    file: z.string().optional(),
    /** Explicit solution file; overrides the `#else` branch of `file`. */
    solution: z.string().optional(),
    /** A program that runs the checks (see Workbook.Check). */
    check: z.string().optional(),
    /** Read-only modules the student's code imports. */
    support: z.array(z.string()).default([]),
    /** Extra interpreter flags, e.g. `-XLambdaCase`. */
    options: z.array(z.string()).default([]),
  })
  .strict();

const exerciseFields = {
  id,
  title: z.string().optional(),
  kind: z.enum(['test', 'challenge']).optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  /** `true`, or an emoji to use instead of the generated one. */
  'start-here': z.union([z.boolean(), z.string()]).default(false),
  long: z.boolean().optional(),
  tags: z.array(z.string()).default([]),
  /** Recommended to have done these first (guidance only, nothing is locked). */
  after: z.array(id).default([]),
  similar: z.array(id).default([]),
  /** Text file, relative to the chapter directory. Defaults to `<id>.typ`. */
  text: z.string().optional(),
  /** Minutes of active work after which to ask whether the student needs help. */
  'help-after': z.number().int().min(1).max(1440).optional(),
  scratch: runnable.optional(),
  code: codeSchema.optional(),
};

export const exerciseSchema = z.object(exerciseFields).strict();

export const pageSchema = z
  .object({
    page: id,
    title: z.string(),
    text: z.string().optional(),
  })
  .strict();

/** Questions about a chapter or section as a whole, placed wherever the author puts this. */
export const checklistSchema = z
  .object({
    checklist: id,
    title: z.string().optional(),
    text: z.string().optional(),
  })
  .strict();

/** Chapter-level defaults: any exercise field except identity and text. */
const defaultsSchema = z
  .object({
    kind: exerciseFields.kind,
    level: exerciseFields.level,
    long: exerciseFields.long,
    tags: exerciseFields.tags,
    scratch: exerciseFields.scratch,
  })
  .partial()
  .strict();

/** Starts a section: every item after it belongs to it, until the next section. */
export const sectionSchema = z.object({ section: z.string().min(1) }).strict();

export const chapterSchema = z
  .object({
    id: id.optional(),
    title: z.string(),
    summary: z.string().optional(),
    /** Typst file for the chapter's start page, relative to the chapter directory. */
    intro: z.string().optional(),
    defaults: defaultsSchema.default({}),
    items: z.array(z.union([sectionSchema, pageSchema, checklistSchema, exerciseSchema])),
  })
  .strict();

export const workbookSchema = z
  .object({
    title: z.string().default('Workbook'),
    language: z.string().default('en'),
    /** Typst file that introduces the course, relative to this file. */
    landing: z.string().optional(),
    /** Where students report problems. Defaults to the issues of the repository the course came from. */
    issues: z.string().url().regex(/^https?:\/\//, 'an http(s) address').optional(),
    /** Chapter directories in order. Defaults to sorted directory names. */
    chapters: z.array(z.string()).optional(),
    /** Groups chapters into parts. The order of the parts sets the order of the chapters. */
    parts: z
      .array(
        z
          .object({
            id: id.optional(),
            title: z.string().min(1),
            summary: z.string().optional(),
            /** false: the part's chapters get no number and do not move the numbers of the others. */
            numbered: z.boolean().default(true),
            chapters: z.array(z.string()).min(1),
          })
          .strict(),
      )
      .optional(),
    defaults: defaultsSchema.default({}),
  })
  .strict();

export const tagsSchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.object({ label: z.string(), color: z.string().optional(), type: z.enum(['topic', 'signal']).default('topic'), description: z.string().optional(), review: z.boolean().default(true) }).strict(),
  ]),
);

export const threadSchema = z
  .object({
    id: id.optional(),
    title: z.string(),
    description: z.string().optional(),
    /** Ordered. A nested list means "any one of these". */
    steps: z.array(z.union([id, z.array(id).min(1)])),
    /** Typst file relative to `threads/`. Having one makes this an adventure. */
    page: z.string().optional(),
    /** The exercise shown as the big finish on the map of an adventure. Has to be one of the steps. */
    finale: id.optional(),
    /** Files that exercises can share through `code: { shared: <this id> }`, relative to `threads/`. */
    files: z.array(z.string()).min(1).optional(),
    /** Read-only files next to `files`. */
    support: z.array(z.string()).default([]),
    /** Language of `files`. */
    language: language.default('haskell'),
    options: z.array(z.string()).default([]),
  })
  .strict();

export type ChapterFile = z.infer<typeof chapterSchema>;
export type ExerciseEntry = z.infer<typeof exerciseSchema>;
export type PageEntry = z.infer<typeof pageSchema>;
