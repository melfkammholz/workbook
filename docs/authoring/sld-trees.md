# SLD trees

Students can draw SLD trees as text, and the workbook checks them. A tree is written in the notation of
[sldcheck](https://github.com/melfkammholz/sldcheck) ([the notation](https://github.com/melfkammholz/sldcheck/blob/main/NOTATION.md)),
and the program it is about is the exercise's `program:`:

```yaml
code:
  language: sld
  file: code/member.sld        # starter and solution in one file, as everywhere
  program: code/member.pl      # the Prolog program the tree is checked against
```

```
?- member(X, [1, 2]), Y is X + 1.
#ifndef TEMPLATE
  | member(X1, [X1|_1]).
  | {X |-> 1, X1 |-> 1, _1 |-> [2]}
  ?- Y is 1 + 1.
    | builtin
    | {Y |-> 2}
    ?- true.                    {X |-> 1, Y |-> 2}
  | member(X2, [_2|T2]) :- member(X2, T2).
  ...
#endif
```

The starter above is only the query, so students begin with the root and draw the rest.
Students see the program as a read-only tab next to their tree.

* **While they write**, the first tab of the panel ("Syntax") reports syntax errors with their position, and the editor
  marks the line. Nothing else is shown yet: the missing branches of a tree that is half drawn would give away what the
  exercise asks for.
* **The picture:** the tree is drawn from what the student wrote, as they write it: goals as boxes, steps as edges with
  the renamed rule and the substitution, pruned alternatives and failures dashed, the trees of negations below. It shows
  the tree as it is written, wrong or not, and never completes it. The node at the cursor is marked, a click goes to its
  line, and the problems found by "Run tests" are marked red or amber. It zooms and pans, and can be saved as SVG. It
  needs `sldcheck` 0.3 or newer, which prints the tree (`--tree`).
* **"Run tests"** checks the tree against the program and reports *every* problem found, each with a code (`E022`) and
  what is wrong, marked in the editor. The test is all or nothing: "The tree is correct" passes when there is no error.
  Warnings, for example for a missing answer at a leaf, do not fail it. sldcheck's messages are in English.
* **`lint --solutions`** checks the reference solution the same way: it must have no error. The starter is not checked.
* **Hints and samples** are written like in any exercise. Because the checker accepts any correct tree, a tree can differ
  from your reference solution in the names of variables and in which most general unifier it uses.

Students can choose a **wide layout** for any exercise with code (the button in the editor's toolbar): the task folds
into a strip on the left and opens over the editor when needed, the editor takes the middle, and feedback, with the
picture of an SLD tree above it, moves to the right.

`check:` does not go with `sld` (the program is the test), and `program:` goes with nothing else. sldcheck handles the
cut, negation as failure, the built-ins `is`, `=`, `==`, `<` and the like, and trees split into parts; it does not handle
`;`, `->`, `call/N`, `findall/3` or infinite branches: such a node is reported as not checked.
The Docker image has `sldcheck`; for a development setup, set `SLDCHECK_BIN` to version 0.2 or newer.
