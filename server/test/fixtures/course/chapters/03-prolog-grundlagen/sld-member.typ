Gegeben sei das Programm `member.pl`. Zeichne den SLD-Baum für die Anfrage
`?- member(X, [1, 2]), Y is X + 1.` Schreibe an jeden Schritt die umbenannte Klausel
und den Unifikator, und an jedes Blatt die Lösung oder den Grund für den Fehlschlag.

So schreibst du einen Baum auf: Ein Knoten beginnt mit `?-`, die Schritte darunter
beginnen mit `|`, und der Knoten, zu dem ein Schritt führt, steht direkt darunter.

```sld
?- p(X).
  | p(a).
  | {X |-> a}
  ?- true.                    {X |-> a}
  | p(b).
  | {X |-> b}
  ?- true.                    {X |-> b}
```

Mit „Tests ausführen“ wird dein Baum gegen das Programm geprüft.

#hint[`Y is X + 1` ist ein eingebautes Prädikat: Der Schritt heißt `builtin`, und der Unifikator bindet `Y`.]
#hint[Eine Liste ohne Elemente passt auf keine Klausel von `member`: Der Schritt heißt `no rule`.]
