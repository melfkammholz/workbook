- Der größte gemeinsamen Teiler (ggT) zweier Ganzzahlen kann mithilfe des
  euklidschen Algorithmus berechnet werden. Implementiere das Verfahren.
  $
  "gcd"(x, y) = cases(
    abs(x) & quad "falls" y = 0\,,
    gcd(y, x "mod" y) & quad "sonst,"
  )
  $ als Funktion `gcd :: Integral a => a -> a -> a`.
- Alternativ kann der ggT auch berechnet werden, indem wir das Produkt des
  Schnittes der Primfaktorzerlegung der beiden Zahlen betrachten, also
  $ product ("PF"(x) inter "PF"(y)), $
  wobei $"PF"$ die Menge der Primfaktoren der gegebenen Zahl (mit
  entsprechenden Mehrfachvorkommen) beschreiben soll. Implementiere diesen
  Ansatz.

#hint[
  - Zur Darstellung der Multimengen eignen sich sortierte Listen gut.
  - Zur Berechnung des Schnittes können zwei sortierte Listen parallel
    durchlaufen werden. Wenn zwei gleiche Elemente zu Beginn der Liste stehen,
    wird eines der Elemente zum Ergebnis hinzugefügt. Im anderen Fall
    überspringen wir das jeweils kleinere Element der beiden.
]
