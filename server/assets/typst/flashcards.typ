// Flashcards. Imported into decks only, after the prelude.
//
// A deck is the student's own Typst text. The server finds the cards in it, and
// gives each new one an id (`id: "k3f9"`) that its schedule belongs to.
// `_lang` is added by the server from `from:`, so code takes the language of the
// exercise. Cloze gaps `{{…}}` are turned into marks by the server before this runs.

#import "prelude.typ": _app-look

#let _card(kind, id, from, lang, body) = html.elem(
  "aside",
  attrs: (
    data-wb: "card",
    data-kind: kind,
    data-id: if id == none { "" } else { id },
    data-from: if from == none { "" } else { from },
  ),
  {
    set raw(lang: lang) if lang != none
    body
  },
)

// A side as a picture laid out like a page: for decks that use what HTML export cannot express.
#let _side(name, body, framed) = html.elem("div", attrs: (data-side: name), if framed { html.frame(block(width: 10cm, _app-look(body))) } else { body })

/// A card with a front and a back. `both: true` also asks it the other way round.
#let flashcard(id: none, from: none, both: false, tags: (), _lang: none, _framed: false, ..sides) = {
  let s = sides.pos()
  _card(if both { "both" } else { "basic" }, id, from, _lang, {
    _side("front", s.at(0, default: []), _framed)
    _side("back", s.at(1, default: []), _framed)
  })
}

#let _flashcard-framed = flashcard.with(_framed: true)

/// A text with gaps: `#cloze[`map` applies a function to {{every element}}.]`.
/// Each gap is asked on its own.
#let cloze(id: none, from: none, tags: (), _lang: none, body) = _card("cloze", id, from, _lang, html.elem("div", attrs: (data-side: "text"), body))

/// A question with answers to choose from, written as in a lesson:
/// `#quiz([Frage], choice[falsch][warum], choice(correct: true)[richtig][warum])`.
#let quiz(id: none, from: none, tags: (), _lang: none, _src: none, question, ..choices) = _card("quiz", id, from, _lang, {
  _side("front", {
    html.elem("div", attrs: (data-part: "question"), question)
    choices.pos().join()
  }, false)
  _side("back", [], false)
})
