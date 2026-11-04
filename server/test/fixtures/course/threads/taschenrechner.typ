
#import "@preview/cetz:0.5.3"

In diesem Abenteuer baust du Schritt für Schritt einen kleinen Taschenrechner.
Jede Aufgabe arbeitet in denselben Dateien weiter, deine Arbeit aus der vorigen
Aufgabe ist also noch da.

#cetz.canvas({
  import cetz.draw: *

  let d = 0.25

  let positions = ((2, 4), (4, 2), (2, 0), (0, 2))

  content((2, 4), [Reguläre Ausdrücke])
  content((4, 2), [$epsilon$-NEA])
  content((2, 0), [NEA])
  content((0, 2), [DEA])

  let edges = (
    ((2.0 + d, 4.0 - d), (4.0, 2.0 + d), [Thompson-Konstruktion]),
    ((4.0, 2.0 - d), (2.0 + d, d), [Elimination von $epsilon$-Transitionen]),
    ((2.0 - d, d), (0.0, 2.0 - d), [Potenzmengenkonstruktion]),
    ((0.0, 2.0 + d), (2.0 - d, 4.0 - d), [Zustandseliminierung]),
  )

  for (i, (from, to, label)) in edges.enumerate() {
    let dir = (to.at(0) - from.at(0), to.at(1) - from.at(1))
    let dir-len = calc.sqrt(dir.at(0) * dir.at(0) + dir.at(1) * dir.at(1))
    let normal = (-dir.at(1) / dir-len, dir.at(0) / dir-len)
    let mid = (from.at(0) + dir.at(0) * 0.5, from.at(1) + dir.at(1) * 0.5)
    let bow = 0.3
    let bend = (mid.at(0) + bow * normal.at(0), mid.at(1) + bow * normal.at(1))

    let anchor = if normal.at(0) > 0 { "mid-west" } else { "mid-east" }

    arc-through(from, bend, to, name: str(i), mark: (end: ">"))
    content(str(i) + ".mid", anchor: anchor, padding: 0.5, label)
  }
})

Am Ende kann dein Rechner Ausdrücke wie $2 dot (3 + 4)$ auswerten, vereinfachen
und wieder lesbar anzeigen.
