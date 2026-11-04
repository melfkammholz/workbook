elternteil(anna, bert).
elternteil(bert, clara).
elternteil(bert, david).

#ifdef TEMPLATE
% grosselternteil(G, K) :- ...
#else
grosselternteil(G, K) :- elternteil(G, E), elternteil(E, K).
#endif
