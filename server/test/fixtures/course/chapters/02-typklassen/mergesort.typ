In Einführung in die Algorithmik#note[Je nach Durchlauf kann sich das
geändert haben.] hast du verschiedene Varianten des Mergesort-Algorithmus
kennengelernt. Eine davon hat ausgenutzt, dass in einer Eingabeliste bereits
nicht-absteigend sortierte Teillisten vorkommen können, um den Algorithmus zu
beschleunigen. Implementiere diese Variante als Funktion
`mergesort :: [Int] -> [Int]`.

Für den Anfang kannst du annehmen, dass die Eingabelisten vom Typ
`[Int]` sind. Wenn wir Typklassen behandelt haben, kannst du
`Ord a => [a]` nutzen -- oder du nutzt letzteres und behandelst es
erstmal so, als wäre es ersteres.

#remark[
  In der Haskell `base`-library wird `sort` aus `Data.List` vergleichbar
  implementiert:
  #link("https://hackage.haskell.org/package/ghc-internal-9.1201.0/docs/src/GHC.Internal.Data.OldList.html#sort")[Data.List.sort].
]
