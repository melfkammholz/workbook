# Writing course content

A course is a plain folder, usually a git repository. Students mount it into the
container and update it with `git pull`; the workbook notices changes by itself
(the page refreshes when students switch back to its tab).

```
content/
  workbook.yml            title, language, optional chapter order, defaults
  tags.yml                topics and signals students can filter by
  prelude.typ             optional: your own Typst helpers, imported everywhere
  threads/
    recursion.yml         learning paths
  chapters/
    01-basics/
      chapter.yml         the list of exercises and pages, with all metadata
      sum.typ             text of the exercise with id "sum"
      code/
        Sum.hs            starter + reference solution
        SumCheck.hs       tests
```

The rule of thumb: **`.yml` holds metadata, `.typ` holds everything that is
rendered** (task, remarks, hints). Ids are stable names (`binary-exponentiation`),
never numbers, so renaming or reordering exercises does not lose students' work.

Check your content any time with

```sh
docker compose run --rm workbook node server/dist/cli.js lint --render --solutions
```

It validates the YAML, finds unknown ids and dependency cycles, compiles every
text with Typst, and runs every test program against your reference solution.

## workbook.yml

```yaml
title: Deklarative Programmierung
id: deklprog            # optional: stable name of the course, see below
exams:                  # optional: suggested to students as the date their flashcards should be ready by
  - title: Erster Prüfungszeitraum
    date: 2027-02-12
  - title: Zweiter Prüfungszeitraum
    date: 2027-04-01
language: de            # language of the texts (hyphenation, "Abbildung 1", ...)
landing: landing.typ    # optional: introduces the course, see below
issues: https://github.com/you/course/issues   # optional, see "Reporting problems"
defaults:               # optional, applies to every exercise
  level: 1
chapters: [01-basics, 02-types]   # optional; default is the sorted folder names
```

Students' flashcards point back to the exercise they came from as `from: "<course id>/<exercise id>"`. Without
`id:`, the course id is made from the title ("Deklarative Programmierung" becomes `deklarative-programmierung`), so
set it before students start making cards if the title may change. Renaming an exercise id breaks the link too: the
card stays, but the app warns that it points nowhere.

A long course can be divided into **parts**. The order of the parts then sets the
order of the chapters, and `chapters:` is not needed. The outline becomes
part → chapter → section → exercise. Chapter numbers continue across parts.

```yaml
parts:
  - title: Funktionale Programmierung
    summary: Programmieren mit Ausdrücken und Typen.    # optional
    chapters: [01-haskell-grundlagen, 02-typklassen]
  - title: Logische Programmierung
    chapters: [03-prolog-grundlagen]
  - title: Präsenzaufgaben
    numbered: false         # its chapters get no number; exercises are numbered within their chapter
    chapters: [woche-03]
```

A part with `numbered: false` suits material that runs alongside the course, such as the exercises of each week's
session: adding a chapter there does not move the numbers of the others.

### The landing page

`landing:` is a Typst file that introduces the course: what it is for, how to work with it, how to reach you
(for example a Mattermost channel). It opens by itself the first time a student opens the course, and stays one click
away on the home page. It does not replace the home page, which is where students pick up their work.

### Reporting problems

Every exercise, page and checklist has a link that opens a new issue with its title and id filled in, never the
student's work. For a course from a GitHub or GitLab repository this works by itself. `issues:` sets the address
if the course is mounted, or lives elsewhere; on other hosts the link just opens that address. Without either there
is no link.

## tags.yml

There are two kinds of tags. A **topic** says what an exercise is about, a **signal**
says what it will be like to do it. They look different in the app and are
separate groups in the filters. Tags are topics unless they say otherwise.

```yaml
diff: Differenzieren                                    # a topic, with a plain label
recursion: { label: Rekursion, color: teal }            # a topic
deep-dive: { label: Deep Dive, type: signal }           # a signal
```

The review page shows students how confident they are per topic. Some topics are not what the course teaches, for example when differentiation is only the example an exercise uses. Those stay useful for filtering, but `review: false` keeps them out of that overview:

```yaml
diff: { label: Differenzieren, review: false }
```

`long: true` on an exercise is a built-in signal: "takes a while".

## chapters/*/chapter.yml

```yaml
title: Typklassen
summary: Verhalten für viele Typen gemeinsam beschreiben.
defaults:               # per chapter; any of kind, level, long, tags, scratch
  scratch: haskell      # every exercise gets an interpreter without a prepared file
items:
  - page: einfuehrung   # an information page: preface, explanation, resources
    title: Einführung in Typklassen

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
* **`extra: true`** marks extra material: what goes beyond the course, for those who want all of it.
  Together with `start-here` it decides what a student's **focus** shows (see below). An exercise is
  never both; `lint` reports that as an error.
* **Next up** links are computed: if B lists A under `after`, A shows B as "next up".
* Text-only exercises need no `code`. Add `scratch: haskell` (here or in
  `defaults`) to give them an interpreter to experiment in.
* Exercises and pages appear in the order of `items`. Sections do not change the numbering.
* `intro: intro.typ` next to `title:` adds text to the chapter's start page, for example `#refs[…]` with references.
  Every chapter has a start page with its progress and contents, with or without this.

### Focus: how much of the course a student sees

When students open a course, they choose how much of it they want in sight, and they can change it any time
in the course menu (next to the course's name). The course states the facts, the app decides what the choices do:

| Focus | Shows |
| --- | --- |
| Essentials | the `start-here` exercises |
| Thorough (the default) | everything except `extra` |
| Everything | all exercises |

Exercises outside a student's focus fold into one quiet line at the end of their section ("2 more")
and open with a click. Nothing is renumbered, search finds everything, and
exercises a student already worked on stay in place. Pages, checklists and chapter texts are always shown, and
an adventure shows all of its steps (those outside the focus faded). A course without `start-here` does not offer
Essentials; a course without `extra` offers no difference between Thorough and Everything, which `lint` mentions
as a note. A chapter without any `start-here` exercise shows none of its exercises under Essentials, so `lint`
warns about it once the course marks `start-here` anywhere.

Signal tags such as Deep Dive stay labels for students; they do not decide the focus.

## The text of an exercise

An exercise file is ordinary Typst. Write the task, and add the extras:

```typst
Implementiere die Funktion `power`. Es gilt $x^n = (x^(n/2))^2$ für gerades $n$.

```haskell
power :: Num a => a -> Integer -> a
```

#hint[Wie viele Multiplikationen braucht $x^8$, wenn du immer quadrierst?]
#hint[Zweiter Hinweis, erst nach dem ersten sichtbar.]

#remark[Komisches Bild, Zusatzkontext oder ein Link für Interessierte.]

Siehe auch #xref("symbolic-differentiation").
```

| Helper | Effect |
| --- | --- |
| `#hint[…]` | Revealed one by one, in order. Students' use of hints is recorded. |
| `#remark[…]` | An aside from you: context, a meme, resources. Shown below the task. |
| `#xref("id")` | Link to another exercise; its title is filled in (and stays current if renamed). Also counts as "builds on". |
| `#sample[…]` | A sample answer to a text question. Optional. Students open it from the menu above their answer, and it only reaches their browser then. Search leaves it out. |
| `#draft-note[…]` | A note to yourself. Never reaches students. |
| `#check[…]`, `#refs[…]` | Highlighted boxes inline in the text. |
| `#diagram[…]` | Draws anything (shapes, `cetz`) as a picture. |
| `#note[…]` | Footnote. |

Inline code and blocks that name no language are highlighted in the language of what they belong to: the exercise's `code`, otherwise the chapter's `scratch`, or the thread's `language` on an adventure page. Name another language where it differs (```` ```haskell (++)``` ````), use `text` for what is not code (```` ```text RegExp.hs``` ````, program output), or start a file with `#set raw(lang: "python")` to change it for the whole file.

Code in ```` ```haskell ```` blocks is highlighted by the app, and gets a copy button. This works for all
common languages, among them `python`, `java`, `c`, `cpp`, `javascript`, `typescript`, `rust`, `go`, `sql`, `bash`,
`prolog`, `ocaml`, `scala`, `kotlin`, `ruby`, `json`, `yaml` and `html`.

### What works in Typst's HTML export

The workbook renders Typst to HTML (so text reflows, can be selected, and follows
the dark theme). Typst's HTML export is still young and **silently drops** some
elements together with their content. The workbook re-implements the common
ones, so these are safe to use: `columns`/`colbreak`, `align`, `grid`, `stack`,
`pad`, `h`, `v`, `line`, `place`, `rect`, `circle`, `ellipse`, `square`,
`polygon`, `curve`, `move`, `rotate`, `scale`, and colored `#text(fill: …)`.
Shapes, `rotate` and friends become pictures (SVG), so their text is not selectable.

A `cetz` canvas works as it is, and a `box` or `block` with a size, fill or stroke becomes a picture too:

```typst
#import "@preview/cetz:0.5.3"

#align(center, cetz.canvas({
  import cetz.draw: *
  circle((0, 0), radius: 1)
}))
```

For anything else that draws and comes out in pieces, wrap it in `#diagram(…)`, which turns all of it into one picture.

Typst packages are downloaded on first use (the container needs internet then) and cached in the data volume. Course text is rendered with Typst's HTML export, which drops what is laid out like a page: put the output of drawing packages (cetz, fletcher, lovelace, …) inside `#diagram[…]`, which draws it as a picture. fletcher exports a `diagram` of its own, so import it with `as fletcher`. (Students' own notes, answers and cards fall back to a picture automatically when something would be lost; course text does not, so a missing `#diagram` shows up as a warning in `lint --render`.)

**Editor:** for writing a course, [Tinymist](https://github.com/Myriad-Dreamin/tinymist) in VS Code (or another editor) gives completion, hover docs and errors on the course repository as it is. Open the repository folder; `prelude.typ` and the workbook helpers are not in it, so Tinymist will mark `#hint`, `#remark` and friends as unknown, which is expected. `lint` is still what checks a course the way the app renders it.
Run `lint --render` to see Typst warnings such as "… was ignored during HTML export".

Not supported: page-level things (`#set page`, headers, page breaks), `image` sizing beyond what the browser does.

## Checklists

Ask over-arching questions about a chapter or section with a checklist. It is an entry in `items`, so you decide where
it goes: after a section, at the end of a chapter, or not at all. One after a section belongs to that section. The last
item of a chapter belongs to none, so a checklist there stands apart from the last section and covers the whole chapter.

```yaml
items:
  - section: Rekursion
  - id: mutual-recursion
  - checklist: selbstevaluation-rekursion
    title: Wo stehst du?         # optional, default "Selbstevaluation" or "Self-evaluation"
    text: rekursion-check.typ    # optional, default <id>.typ
```

```typst
Nimm dir kurz Zeit und schätze dich ehrlich ein.

#question[Ich kann erklären, warum eine rekursive Funktion terminiert.]
#question[Ich kann $f(n) = f(n - 1) + 1$ als Haskell-Funktion schreiben.]
```

Students rate themselves from 1 to 5 on each question and can add a note. Low ratings and notes appear on their review
page. Checklists do not count towards the exercises done. Answers belong to the text of a question: you can reorder
questions freely, but rewording one starts it over.

## Programming exercises

An exercise with a `code:` entry is a programming exercise: students get a code
editor instead of a text answer. Only the language is required, so an exercise
needs neither a template nor tests.

```yaml
code:
  language: haskell                      # see below
  file: code/Gcd.hs                      # optional: starter and solution in one file
  check: code/GcdCheck.hs                # optional: tests, run with "Run tests"
  support: [code/Helpers.hs]             # modules the student's code can import, shown as read-only tabs
  options: ["-XLambdaCase"]              # extra ghci flags
```

| `language` | Editor | Interpreter | Tests |
| --- | --- | --- | --- |
| `haskell` (default) | yes | `ghci` | `Workbook.Check` |
| `prolog` | yes | SWI-Prolog | `workbook_check` |
| anything else, e.g. `python` | yes, with highlighting | no | no |

Without a runner the app says so, and students try their code on their own computer.

For Haskell the student's file is named after the `module` line (`module
Playground.Gcd` becomes `Playground/Gcd.hs`), so imports in your tests just work.
The file is loaded into a warm interpreter and reloaded on every change (diagnostics
appear in the editor within ~100 ms); the student can evaluate expressions at once.

### Starter and solution in one file

Keep both in the same file; the part the student must write goes in the `#ifdef TEMPLATE` branch.

```haskell
module Gcd (gcd) where

#ifdef TEMPLATE
gcd :: Int -> Int -> Int
gcd = undefined
#else
gcd a 0 = abs a
gcd a b = gcd b (a `mod` b)
#endif
```

The student gets the `TEMPLATE` branch, the **Show the reference solution**
button shows the `#else` branch. Only `#ifdef`, `#ifndef`, `#else` and `#endif` on
`TEMPLATE` are understood. Alternatively point `solution:` to a separate file.

### Tests in Haskell

A test file (the `check:` entry) is an ordinary Haskell program (no `module` line needed) using
`Workbook.Check`, which also re-exports QuickCheck:

```haskell
import Workbook.Check
import Gcd

main :: IO ()
main = runChecks
  [ eq "gcd 12 18 = 6" (gcd 12 18) 6
  , approx "pi-ish" (4 * atan 1) 3.14159
  , check "is even" (even (gcd 4 6))
  , prop "agrees with Prelude" $ \x y -> gcd x y == Prelude.gcd x y
  , checkIO "does not loop" (pure True)
  ]
```

* A student's `undefined` or missing method is reported as **"not implemented yet"**, not as a failure.
* Every test has a 5 s limit; the whole run is killed after 30 s.
* Whatever the student's code prints is kept separate from the results.
* Failed `eq` tests show expected and actual, failed `prop` tests the counterexample.
* Because the student cannot see your test file, **name tests so they teach** ("gcd 0 7 = 7").

### Tests in Prolog

A test file is a list of `check/2` facts, run in order after the student's file is loaded.
Helper predicates can sit in the same file.

```prolog
check("laenge([], 0) gilt",       holds(laenge([], 0))).
check("laenge([a], 2) gilt nicht", fails(laenge([a], 2))).
check("[a, b] hat die Länge 2",   equals(N, laenge([a, b], N), 2)).
check("alle Elemente",            solutions(X, mitglied(X, [a, b]), [a, b])).
```

| Test | Passes when |
| --- | --- |
| `holds(Goal)` | `Goal` succeeds |
| `fails(Goal)` | `Goal` fails |
| `equals(Var, Goal, Expected)` | the first solution of `Goal` binds `Var` to `Expected` |
| `solutions(Var, Goal, Expected)` | all solutions for `Var` are `Expected`, in any order |

The rules above apply here too: a missing predicate is **"not implemented yet"**, and each test has a 5 s limit.

Two traps when writing them:

* The student's code runs in another module than the test file. A helper you define in the test file works inside a goal, but not as an argument the student's code passes to `call`. So `map(inc, ...)` with your own `inc/2` is "not implemented yet"; use a built-in such as `succ/2`.
* SWI-Prolog autoloads library predicates, so a task's predicate may already exist: `reachable/3` comes from `library(ugraphs)`. A starter without it then gives wrong answers instead of "not implemented yet". `lint --solutions` warns about this. Then put part of the definition in the starter, or use another name.
Starter and solution in one file work as for Haskell. In the interpreter students type one query per
line; it shows at most 10 solutions.

`lint --solutions` runs your tests on the reference solution (all must pass) and on the
starter (nothing may fail with a wrong answer, only "not implemented yet"). It warns when the tests do not even compile
with the starter, because a student's first test run then ends in an error. That can be on purpose, when students add
instances the tests use. When students write a signature themselves, the starter has none, so give the tests the type
they expect in one place, for example `typedFoldMaybe :: b -> (a -> b) -> Maybe a -> b` with
`typedFoldMaybe = foldMaybe`, and test through that.

## threads/*.yml: paths and adventures

```yaml
title: Rekursion verstehen und anwenden
description: Vom Worauf-achten bis zu effizienten Algorithmen.
steps:
  - recursion-care
  - mutual-recursion
  - [binary-exponentiation, gcd-pf]   # a nested list means "either of these"
```

That is a simple **path** on the home page. The "next up" suggestions use `after` and `similar` on the exercises themselves.

Give it a page and it becomes an **adventure**: highlighted on the home page, with a page of its own (your text and
diagrams, a map of the route, the progress), a badge on its exercises and a filter in the outline. The map is drawn
from `steps`. Nothing is locked: every stop stays clickable. `finale:` optionally marks one step as the big finish.
In each chapter, put the exercises of an adventure together in a section named after it, after the chapter's other exercises. `lint` warns otherwise. A simple path may cut across sections. A section whose exercises all belong to one adventure links to that adventure's page from the outline and the chapter page. Side notes that go beyond the course fit in a page of their own, in a last section such as "Vertiefung", with a short remark linking there from the exercise.

```yaml
title: Ein kleiner Taschenrechner
description: Vom Datentyp zum fertigen Rechner.
page: taschenrechner.typ     # relative to threads/
finale: rechner-anzeigen     # optional
steps: [rechner-auswerten, rechner-vereinfachen, rechner-anzeigen]
```

### Shared files

Most exercises have a file of their own. When exercises build on each other, they can work in the same files instead,
so a student's work carries over. The thread declares them, and each exercise opts in and brings its own tests. Several
files show up as tabs, and they can import each other. Students cannot add files.

```yaml
# threads/taschenrechner.yml
language: haskell            # default
files:                       # relative to threads/
  - code/Expr.hs
  - code/Pretty.hs
support: [code/Helpers.hs]   # optional, read-only
```

```yaml
# chapter.yml
- id: rechner-auswerten
  code:
    shared: taschenrechner
    check: code/RechnerAuswertenCheck.hs
```

**You decide which part of the solution an exercise reveals.** A whole file would give away every later exercise,
so name the exercises on each part. The student sees only the parts that name their exercise, and a part that names
nobody is never shown. An exercise with no part has no solution button.

```haskell
eval :: Expr -> Int
#ifdef TEMPLATE rechner-auswerten
eval = undefined
#else
eval (Num n) = n
eval (Add a b) = eval a + eval b
#endif
```

`lint --solutions` runs each exercise's tests against the complete solution, so tests can rely on any part of it.

Status, notes, hints and time stay per exercise. "Start over" resets the open file for all exercises that share it, with
a warning, and the old version stays in the history. When you update a course, students keep what they wrote in these
files, so changes to the template only reach those who have not edited that file yet.

## What students tell you

Only students decide when an exercise is finished; passing tests never marks anything. When they mark an exercise
**done** or **review later** they can rate their confidence (1 to 5), say how they got there (alone, hints, solution,
help) and write down what is still open. All of it can be skipped. Together with the time spent,
number of test runs, hints opened and whether the solution was viewed, that is what they see on their own
**Review** page (the clipboard icon). It stays on their computer.

Students can opt in to achievements, animal friends from the recommended exercises they finish, a plant per chapter and small celebrations. There is nothing to set up. A chapter's
plant follows the student's focus, so every focus can feel finished: it is 🌱 once started, 🌿 at half of the
exercises in the focus, and 🌳 with all of them done and its checklists answered (with nothing of a chapter in the
focus, the answered checklists grow it). In a course without `extra`, Thorough and Everything keep the older rule:
the recommended exercises, or half of all exercises in a chapter without recommended ones. Plants never depend on
ratings. Animals always come from the `start-here` exercises, whatever the focus.

Animals follow from an exercise's id unless you choose one with `start-here: 🦔`, so some may repeat, and students then see a count. `lint` lists repeats as a note, in case you want to change them.
