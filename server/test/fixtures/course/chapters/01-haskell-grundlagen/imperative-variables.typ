In imperativen Programmiersprachen sind Variablen Namen für Speicherzellen,
deren Werte zum Beispiel in Schleifen verändert werden können. Als Beispiel
betrachte die Funktionen `clz` und `popcnt`.
#columns(2, gutter: 1em)[
  ```py
  def clz(n):
    k = 0
    while n > 0:
      n //= 2
      k += 1
    return 64 - k
  ```
  #colbreak()
  ```py
  def popcnt(n):
    k = 0
    while n > 0:
      if n % 2 == 1:
        k += 1
      n //= 2
    return k
  ```
]
In Haskell sind Variablen keine Namen für Speicherzellen. Wie können wir
dieses Programm in Haskell umsetzen? Wo wandert das `k` hin oder wo wandert
im Allgemeinen der Zustand hin?
