check("anna ist Großelternteil von clara", holds(grosselternteil(anna, clara))).
check("bert ist kein Großelternteil von clara", fails(grosselternteil(bert, clara))).
check("anna hat genau zwei Enkelkinder", solutions(K, grosselternteil(anna, K), [clara, david])).
