# threads/*.yml: paths and adventures

```yaml
title: Rekursion verstehen und anwenden
description: Vom Worauf-achten bis zu effizienten Algorithmen.
steps:
  - recursion-care
  - mutual-recursion
  - [binary-exponentiation, gcd-pf]   # a nested list means "either of these"
```

That is a simple **path** on the home page. The "next up" suggestions use `after` and `similar` on the exercises themselves.

A path can also be one of the workbook's building blocks rather than a topic: a session's exercises, a homework
sheet, an old exam. Say which with `kind:` (`session`, `homework` or `exam`). Each kind has a page of its own,
linked at the top of the outline, that lists its groups in the order of their file names (`woche-03.yml`,
`woche-04.yml`, …) with their progress. The exercises themselves live in the chapters they belong to by topic;
mark what a session covers only for context as `extra: true`, and it folds away like other extra material.

```yaml
# threads/woche-03.yml
title: "Woche 3: Faltung"
kind: session
steps: [falten-ohne-rekursion, fold-maybe-either, falten-mit-rekursion, fold-labeled-tree]
```

Give it a page and it becomes an **adventure**: highlighted on the home page, with a page of its own (your text and
diagrams, a map of the route, the progress), a badge on its exercises and a filter in the outline. The map is drawn
from `steps`. Nothing is locked: every stop stays clickable. `finale:` optionally marks one step as the big finish.
In each chapter, put the exercises of an adventure together in a section named after it, after the chapter's other exercises. `lint` warns otherwise. A simple path may cut across sections. A section whose exercises all belong to one adventure links to that adventure's page from the outline and the chapter page. Side notes that go beyond the workbook fit in a page of their own, in a last section such as "Vertiefung", with a short remark linking there from the exercise.

```yaml
title: Ein kleiner Taschenrechner
description: Vom Datentyp zum fertigen Rechner.
page: taschenrechner.typ     # relative to threads/
finale: rechner-anzeigen     # optional
steps: [rechner-auswerten, rechner-vereinfachen, rechner-anzeigen]
```

## Shared files

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
a warning, and the old version stays in the history. When you update a workbook, students keep what they wrote in these
files, so changes to the template only reach those who have not edited that file yet.
