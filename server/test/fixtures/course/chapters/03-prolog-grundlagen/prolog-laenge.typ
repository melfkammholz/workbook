Definiere rekursiv das Prädikat `laenge/2`, das die Länge einer Liste bestimmt,
ohne das eingebaute `length/2` zu verwenden. Es gilt:

- Die leere Liste hat die Länge 0.
- Eine Liste mit Kopf und Rest ist um eins länger als ihr Rest.

```prolog
?- laenge([a, b, c], N).
N = 3.
```

#hint[Das Muster `[_|T]` passt auf jede nichtleere Liste.]
#hint[Die Länge berechnest du mit `is`, nachdem der rekursive Aufruf fertig ist.]
