Gegeben sei das folgende Haskell-Programm.
```hs
even :: Int -> Bool
even 0 = True
even n = odd (n - 1)

odd :: Int -> Bool
odd 0 = False
odd n = even (n - 1)
```

- Berechne das Ergebnis von `odd (1 + 1)` händisch.
- Wie sieht der Auswertungsgraph für den Ausdruck `odd (1 + 1)` aus?
  - Welcher Pfad entspricht deiner händischen Auswertung?
  - Welcher Pfad entspricht der Auswertung, wie sie in Haskell stattfindet?
  - Welcher Pfad entspricht der Auswertung, wie sie in Python sinngemäß
    stattfindet?
