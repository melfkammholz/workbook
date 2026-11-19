# Writing workbook content

A workbook is a plain folder, usually a git repository. Students mount it into the
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

## Topics

One file per topic in `docs/authoring/`:

- [workbook.yml: title, landing page, reporting problems](authoring/workbook-yml.md)
- [tags.yml: topics and signals](authoring/tags.md)
- [chapters/*/chapter.yml: exercises, pages, Focus](authoring/chapters.md)
- [The text of an exercise: Typst, hints, what works in HTML export](authoring/exercise-text.md)
- [Checklists](authoring/checklists.md)
- [Lessons and their widgets](authoring/lessons.md)
- [Programming exercises: starter and solution, tests in Haskell and Prolog](authoring/programming.md)
- [SLD trees](authoring/sld-trees.md)
- [threads/*.yml: paths, adventures, shared files](authoring/threads.md)
- [References](authoring/references.md)
- [What students tell you](authoring/students.md)
