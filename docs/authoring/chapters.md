# chapters/*/chapter.yml

```yaml
title: Typklassen
summary: Verhalten für viele Typen gemeinsam beschreiben.
defaults:               # per chapter; any of kind, level, long, tags, scratch
  scratch: haskell      # every exercise gets an interpreter without a prepared file
items:
  - page: einfuehrung   # an information page: preface, explanation, resources
    title: Einführung in Typklassen
  - page: autodiff-any-derivative
    title: Ableitungen beliebiger Ordnung
    extra: true           # a deep dive: folds away unless the student wants everything; the app says it is extra
    tags: [deep-dive]     # optional, as for exercises

  - section: Ableitungen   # optional: everything below belongs to it, until the next section

  - id: symbolic-differentiation
    title: Symbolisches Differenzieren   # optional: derived from the text if missing
    kind: challenge     # test (default) or challenge
    level: 2            # 1 easy (default), 2, 3
    long: true          # takes a while
    help-after: 45      # minutes of active work before asking if help is needed (default: the student's setting, 30)
    start-here: true    # recommended for a first pass (or an emoji: start-here: 🦔)
    extra: false        # extra material, only for students who want everything (never with start-here)
    tags: [diff]
    after: [other-id]   # nice to have done first (never locks anything)
    similar: [another-id]
    text: other-name.typ    # default is <id>.typ

  - id: automatic-differentiation
    code:
      file: code/AutomaticDifferentiation.hs
      check: code/AutomaticDifferentiationCheck.hs
```

* **`start-here`** marks the exercises you want students to do first so the long
  list does not overwhelm them. Without an emoji, a stable animal is picked per exercise.
* **`extra: true`** marks extra material: what goes beyond the workbook, for those who want all of it.
  Together with `start-here` it decides what a student's **focus** shows (see below). An exercise is
  never both; `lint` reports that as an error.
* **Next up** links are computed: if B lists A under `after`, A shows B as "next up".
* Text-only exercises need no `code`. Add `scratch: haskell` (here or in
  `defaults`) to give them an interpreter to experiment in.
* Exercises and pages appear in the order of `items`. Sections do not change the numbering.
* `intro: intro.typ` next to `title:` adds text to the chapter's start page, for example `#cite-work` entries with references.
  Every chapter has a start page with its progress and contents, with or without this.

## Focus: how much of the workbook a student sees

When students open a workbook, they choose how much of it they want in sight, and they can change it any time
in the workbook menu (next to the workbook's name). The workbook states the facts, the app decides what the choices do:

| Focus | Shows |
| --- | --- |
| Essentials | the `start-here` exercises |
| Thorough (the default) | everything except `extra` |
| Everything | all exercises |

Exercises outside a student's focus fold into one quiet line at the end of their section ("2 more")
and open with a click. Nothing is renumbered, search finds everything, and
exercises a student already worked on stay in place. Pages, checklists and chapter texts are always shown, and
an adventure shows all of its steps (those outside the focus faded). A workbook without `start-here` does not offer
Essentials; a workbook without `extra` offers no difference between Thorough and Everything, which `lint` mentions
as a note. A chapter without any `start-here` exercise shows none of its exercises under Essentials, so `lint`
warns about it once the workbook marks `start-here` anywhere.

Signal tags such as Deep Dive stay labels for students; they do not decide the focus.
