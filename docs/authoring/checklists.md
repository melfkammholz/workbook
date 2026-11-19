# Checklists

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
