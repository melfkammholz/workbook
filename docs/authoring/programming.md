# Programming exercises

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
| `python` | yes | Python 3 | no (`check:` is ignored, `lint` warns) |
| `sld` | yes, with highlighting | no, but the syntax is checked while typing | [`sldcheck`](sld-trees.md), against a Prolog program |
| anything else, e.g. `java` | yes, with highlighting | no | no |

Without a runner the app says so, and students try their code on their own computer.

Python runs the student's file afresh on every change, in a clean namespace, so its
functions can then be called at the `>>>` prompt. Put a program in a `def main()`, and
tell students to call `main()`: otherwise it would run on every keystroke.

For Haskell the student's file is named after the `module` line (`module
Playground.Gcd` becomes `Playground/Gcd.hs`), so imports in your tests just work.
The file is loaded into a warm interpreter and reloaded on every change (diagnostics
appear in the editor within ~100 ms); the student can evaluate expressions at once.

## Starter and solution in one file

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

## Tests in Haskell

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

## Tests in Prolog

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
