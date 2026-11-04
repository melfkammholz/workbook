check("die leere Liste hat die Länge 0", equals(N, laenge([], N), 0)).
check("[a, b, c] hat die Länge 3", equals(N, laenge([a, b, c], N), 3)).
check("[a] hat nicht die Länge 2", fails(laenge([a], 2))).
