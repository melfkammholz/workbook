Neben dem symbolischen Differenzieren (siehe #xref("symbolic-differentiation")) gibt es
das _automatische_ Differenzieren: Wir rechnen nicht mit Ausdrücken, sondern mit
Paaren aus Funktionswert und Ableitung. Ein Wert `D x d` steht für $f(x)$ und $f'(x)$.

Die Funktionen `d1` und `d2` berechnen die erste und zweite Ableitung einer
Funktion, indem sie diese auf Werte vom Typ `D a` anwenden. Damit das klappt,
muss `D a` wie eine Zahl benutzt werden können.

- Vervollständige die Instanzen von `Num`, `Fractional` und `Floating` für `D a`
  so, dass jede Operation Wert _und_ Ableitung korrekt berechnet (Summen-, Produkt-,
  Quotienten- und Kettenregel).
- Überprüfe in `ghci`, dass `d1 (\x -> x * x) 3` den Wert `6` liefert.

#hint[Für $f + g$ gilt $(f + g)' = f' + g'$ — das ist der einfachste Fall.]
#hint[Produktregel: $(f g)' = f' g + f g'$. Bei `D x1 d1 * D x2 d2` ist `x1` der Wert von $f$ und `d1` seine Ableitung.]
#hint[Kettenregel für `sin`: $(sin f)' = f' dot cos f$. Die anderen Funktionen aus `Floating` funktionieren genauso.]

#remark[Automatisches Differenzieren ist das Verfahren hinter dem Training neuronaler Netze.]
