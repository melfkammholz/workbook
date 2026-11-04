Das Potenzieren einer Zahl $x$ (oder eines Elements einer Halbgruppe) mit
einem natürlich-zahligen Exponenten $n$ ist mit $cal(O)(log n)$
Multiplikationen möglich. Dafür betrachten wir
$
x^n = cases((x^(n/2))^2 & "falls" n "gerade,", x dot x(x^((n-1)/2))^2 & "sonst.")
$
Implementiere eine Funktion, die diese Variante des Potenzierens umsetzt.

#remark[
  `(^)` ist so in Haskell implementiert (siehe
  #link("https://hackage-content.haskell.org/package/ghc-internal/docs/src/GHC.Internal.Real.html#powImpl")[`powImpl`]).
]
