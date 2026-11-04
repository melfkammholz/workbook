Die Ableitung einer Funktion $f : RR -> RR$ kann mithilfe des
Differenzenquotienten $(f(x+h)-f(x))/h$ für kleines $h$ approximiert werden.
Ein andere Methode zur Berechnung der Ableitung ist symbolisches Differenzen
und ähnelt dem, wie wir händisch Ableitungen berechnen.
Eine Funktion sei dargestellt durch den folgenden Typ:
```hs
data Fun = X            -- x     (Variable x)
         | E            -- e     (Euler's constant)
         | Num Double   -- c     (Constant)
         | Ln Fun       -- ln    (Natural logarithm)
         | Fun :+: Fun  -- f + g (Addition)
         | Fun :-: Fun  -- f - g (Subtraction)
         | Fun :*: Fun  -- f * g (Multiplication)
         | Fun :/: Fun  -- f / g (Division)
         | Fun :<: Fun  -- f o g (Composition)
         | Fun :^: Fun  -- f ^ g (Exponentiation)

-- Example
f :: Fun
f = (E :^: X) :<: (X :*: X)  -- (e^x) o (x * x) = e^(x^2)
```
- Gib die Funktion $sigma(x) = 1/(1+e^(-x))$ als Wert des Typs `Fun` an.
- Implementiere eine Funktion `($$) :: Fun -> Double -> Double`, die
  eine gegebene Funktion in einem gegebenen Punkt auswertet.
- Implementiere eine Funktion `derive :: Fun -> Fun`, die eine
  gegebene Funktion ableitet. Die Funktionen müssen nach dem Ableiten nicht
  vereinfacht werden.

#remark[
  Hier findest du eine
  #link("https://de.wikipedia.org/wiki/Differentialrechnung#Zusammenfassung")[Zusammenfassung der Ableitungsregeln].
]
