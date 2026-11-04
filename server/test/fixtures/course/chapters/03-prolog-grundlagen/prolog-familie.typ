In `familie.pl` stehen bereits Fakten der Form `elternteil(Elternteil, Kind)`.

Definiere das Prädikat `grosselternteil/2`, das gilt, wenn `G` ein Elternteil
eines Elternteils von `K` ist.

Probiere danach im Interpreter aus:

```prolog
?- grosselternteil(anna, K).
```

#hint[Du brauchst eine Regel mit zwei Teilzielen und einer Hilfsvariable für den Elternteil dazwischen.]
