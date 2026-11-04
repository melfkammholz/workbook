#ifdef TEMPLATE
% laenge(Liste, N) :- ...
#else
laenge([], 0).
laenge([_|T], N) :- laenge(T, M), N is M + 1.
#endif
