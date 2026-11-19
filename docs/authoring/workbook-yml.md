# workbook.yml

```yaml
title: Deklarative Programmierung
id: deklprog            # optional: stable name of the workbook, see below
exams:                  # optional: suggested to students as the date their flashcards should be ready by
  - title: Erster Prüfungszeitraum
    date: 2027-02-12
  - title: Zweiter Prüfungszeitraum
    date: 2027-04-01
language: de            # language of the texts (hyphenation, "Abbildung 1", ...)
landing: landing.typ    # optional: introduces the workbook, see below
issues: https://github.com/you/course/issues   # optional, see "Reporting problems"
defaults:               # optional, applies to every exercise
  level: 1
chapters: [01-basics, 02-types]   # optional; default is the sorted folder names
```

Students' flashcards point back to the exercise they came from as `from: "<course id>/<exercise id>"`. Without
`id:`, the workbook id is made from the title ("Deklarative Programmierung" becomes `deklarative-programmierung`), so
set it before students start making cards if the title may change. Renaming an exercise id breaks the link too: the
card stays, but the app warns that it points nowhere.

A long workbook can be divided into **parts**. The order of the parts then sets the
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

A part with `numbered: false` suits material that runs alongside the workbook, such as the exercises of each week's
session: adding a chapter there does not move the numbers of the others.

## The landing page

`landing:` is a Typst file that introduces the workbook: what it is for, how to work with it, how to reach you
(for example a Mattermost channel). It opens by itself the first time a student opens the workbook, and stays one click
away on the home page. It does not replace the home page, which is where students pick up their work.

## Reporting problems

Every exercise, page and checklist has a link that opens a new issue with its title and id filled in, never the
student's work. For a workbook from a GitHub or GitLab repository this works by itself. `issues:` sets the address
if the workbook is mounted, or lives elsewhere; on other hosts the link just opens that address. Without either there
is no link.
