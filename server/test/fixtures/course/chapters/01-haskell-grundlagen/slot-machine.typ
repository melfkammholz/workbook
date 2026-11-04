Um ein weiteres Glücksspiel neben Blackjack in diesem Modul vorzustellen,
implementieren wir in diesem Test einen einarmigen Banditen. Diese soll einen
initialen Zustand haben und als Ergebnis ein Tripel und einen neuen Zustand
liefern. Sowohl der Zustand als auch das Tripel soll aus Ganzzahlen bestehen.

- Überlege dir welche Signatur die Funktion haben muss. Dafür kannst du die
  Überlegungen aus #xref("imperative-variables") fortführen.
- Sei $s$ der initiale Zustand, dann soll das Tripel
  $ ((s + 5) mod 3, (s + 7) mod 3, (s + 11) mod 3) $
  sein und der neue Zustand $s + 11$. Implementiere eine Funktion
  `slotMachine` mit deinem überlegten Typ. Du hast gewonnen, wenn
  alle Zahlen des Tripels gleich sind.

#remark[Casinos lieben diesen Spiel-Automaten.]
