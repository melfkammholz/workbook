# Lessons

A lesson explains something on one scrolling page, with things to try out in between. Students mark it done; the
widgets in it start fresh on every visit, so coming back is a chance to test oneself again.

```yaml
items:
  - lesson: falten-ohne-rekursion
    title: Falten ohne Rekursion
    text: falten.typ            # optional, default <id>.typ
    tags: [rekursion]           # optional; quizzes turned into flashcards get these tags too
```

The text is ordinary Typst. Widgets are configured, not programmed: you say what to show, the app knows how it
behaves. Their parts are Typst too, so feedback and code in them work as everywhere else.

| Widget | Effect |
| --- | --- |
| `#quiz([Frage], choice[…][Warum falsch], choice(correct: true)[…][Warum richtig])` | Pick an answer; a wrong one explains itself and the student tries again. "Show answer" reveals it. |
| `#steps(step(label: "…")[…], step[…])` | One state at a time, with buttons to go back and forth, e.g. an evaluation. |
| `#tabs(label: "Datentyp", tab("Maybe a")[…], tab("Either a b")[…])` | The same thing for several examples. `label` (optional) names the choice. |
| `#recipe(step(label: "Titel")[Was zu tun ist], …, example("Maybe a", [Ergebnis 1], …), example(…))` | A numbered procedure, each step next to what it gives for the example the student picks. One result per step and example. |
| `#fold-signature("data Maybe a = Nothing \| Just a")` | From a data declaration to the signature of its fold: write the constructors' types, replace the type by `r`, assemble the signature. Everything, including the wrong pieces offered, is worked out from the declaration. `given: true` starts with the constructors' types written out; `fold: "maybe"` names the fold. |

Two more widgets are about folds, and compute their results: the app writes the fold from the declaration, and
the interpreter works out what comes out. You write the choices, never the answers.

```typst
// Pick a value and an answer per constructor; the fold picks the line, the line answers.
// An answer for a constructor with fields is the body of its function, the fields are x, y, z.
#fold-explorer(
  "data Maybe a = Nothing | Just a",
  type: "Maybe Int",
  values: ("Nothing", "Just 3", "Just 8"),
  results: (
    (type: "Int", Nothing: ("0", "100"), Just: ("x + 1", "x * 2")),
    (type: "Bool", Nothing: ("False", "True"), Just: ("x > 5", "even x")),
  ),
)

// The value as a tree: constructors replaced by the fold's functions, these filled in,
// then folded together from the leaves, with the expression underneath.
#fold-tree("data Tree a = Leaf | Node (Tree a) a (Tree a)", "Node (Node Leaf 1 Leaf) 2 Leaf",
  type: "Tree Int", functions: (Leaf: "0", Node: "\\l x r -> l + x + r"))
```

```typst
// A fold computed step by step: constructors replaced, then folded from the leaves, the expression at
// every step underneath. Before a node is applied, what can be worked out is: (\_ -> sum) "y" is sum.
// Parts the result never needs (an `error` that `const` ignores) are shown faintly and skipped.
#fold-steps("data [a] = a : [a] | []", "[3, 7]", type: "[Int]",
  predict: ("[3,7]", "10", "2"),              // optional: guess first; the interpreter knows the answer
  folds: ((name: "Summe", functions: ("(:)": "(+)", "[]": "0")),
          (name: "Erstes Element", functions: ("(:)": "const", "[]": "error \"empty list\""))))

// The evaluation of a small program, one reduction at a time. The student clicks the part that comes next
// under the `rule` ("innermost", "outermost", "outermostShared" = arguments shared as `let` bindings, "free" =
// any part). Definitions are one equation per line (no pattern matching, no `if`); the term has numbers,
// calls, + - * and `let`. A wrong click names why and costs nothing; nothing is counted. `lint` reads the spec.
#eval-path("inc n = n + 1\ndouble x = x + x", "double (inc 3)", rule: "outermost",
  explain: (outer: "Außen kommt zuerst: double wird vor dem Argument aufgelöst."))  // explain is optional:
                                      // keys inner, outer, left (wrong clicks) and done (the end message)

// Two pieces of code side by side; what corresponds is marked [[id|text]] in both.
#compare(pairs: (nil: "Die leere Liste", rec: "Der rekursive Aufruf"),
  notes: (nil: [Der Fall `[]` wird zu `fnil`.], rec: [Rechts ist nur noch das Ergebnis da.]),
  [```
  length [] = [[nil|0]]
  length (x : xs) = 1 + [[rec|length xs]]
  ```],
  [```
  length = foldr (\_ y -> 1 + [[rec|y]]) [[nil|0]]
  ```])
```

More for lessons:

| Helper | Effect |
| --- | --- |
| `#practice("id", "id2", note: […], comments: ("id2": […]))` | The exercises that go with a lesson, as a list to click through: each title, level and whether it is done. The app puts the headline “Exercises for this lesson” above it, so write no call to action (“Jetzt bist du dran”) before it. Optional: `note`, one line under the headline, and `comments`, a short word beside an exercise (e.g. `[Extra]`). `lint` checks the ids. |
| `#flow(flow-node("a", "Start", kind: "start"), flow-node("b", "Fertig?", at: (0, 1), kind: "decision"), flow-edge("a", "b", label: "ja"))` | A flowchart drawn in the look of the lesson. Each box has an id, a plain-text label, a place on a grid (`at: (column, row)`, from 0) and optionally a `kind` (`start`, `decision`, `good`, `bad`) and a quieter second line `note`. Arrows go straight down within a column, straight across within a row, up and around for a loop back, and in a small loop for a box to itself. Put it in `#figure(…, caption: […])` for a caption. Use it instead of a Graphviz `#diagram` for flowcharts. |
| `#open-question[Frage][Hinweis]` | A question to think about, with no answer to pick. The hint under it is optional, and so is `answer: […]`: it adds an Answer button that shows it (it is never part of the AI prompt). Every question box in a lesson, quizzes too, has the same buttons: Card, Note, and Answer where there is one. |
| `#muted[…]` | A quiet note inside a line, e.g. in a table cell. |
| `#wide[…]` | More room for a dense widget, e.g. two trees side by side: wider than the text (up to 70rem), as far as the page allows. |
| `#expr-trees((expr: "f 1 (f 2 z)", caption: "…"), …, colors: (f: 3, z: 1))` | Expressions drawn as trees, side by side. |
| `#fold-list(xs: ("1", "2"), folds: ((name: "foldl (flip (:)) []", dir: "left", fn: "flip (:)", start: "[]"), …))` | A list folded element by element, input and accumulator as cards; every step computed. |
| `#bracketing(ops: ((op: "+", list: ("1", "2", "3"), assoc: true, starts: ((value: "0", neutral: true), …)), …))` | Where `foldr` and `foldl` put the brackets and the start value, with the results computed. |

A lesson can be `extra: true` in `chapter.yml`, like an exercise or a page: it then only shows in the focus "everything".
A page is a lesson without a done state: both are set in the same reading column, at the same width as exercise text.
Widgets take the width of the text; wrap a dense one in `#wide[…]` to give it more room.
Lessons can be steps of a path or adventure. With flashcards on, students can turn any `#quiz` into a card of
their own (a quiz card, written the same way).

Code in a title is written in backticks, as in the text: `title: "`foldl` und `foldr`"` (in quotes: YAML does not
allow a backtick at the start of a plain value). The app shows it in the code font.

Math in a title is written between dollar signs, as in Typst: `title: Das Newton-Verfahren für $x^2 = a$`. Titles read the
basics (letters, numbers, Greek names, `^`, `_`, `a/b`, `sqrt(x)`, `sum`, arrows); a title it cannot read is shown as
typed. `\$` is a dollar sign. Headings of a lesson keep their math in the outline.

Lists have no declaration in Haskell; write `"data [a] = a : [a] | []"` for them. The fold is then `foldr`, with
the constructors in the order of that line, and the functions are keyed `"(:)"` and `"[]"`.

Widgets nest (`#steps` inside a `#tab`) and work in exercises and pages too. Without the app their parts are shown
one after the other. In a lesson, `#remark` stays where you put it, as a note in the text, and each `=` heading is a
section that students see in the outline while they read.
