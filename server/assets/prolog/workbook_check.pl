% Runs an exercise's tests against a student's file.
%
%   swipl workbook_check.pl -- Student.pl Tests.pl
%
% A test file is a list of facts, in the order they should appear:
%
%   check("laenge([], 0)",  holds(laenge([], 0))).
%   check("laenge([a], 2) stimmt nicht", fails(laenge([a], 2))).
%   check("laenge([a,b], N) gibt 2", equals(N, laenge([a,b], N), 2)).
%   check("mitglied findet alle", solutions(X, mitglied(X, [a,b]), [a,b])).
%
% Results are printed as marked JSON lines, the same format as Workbook.Check:
%   @@WB@@{"name":…,"status":"pass|fail|error|timeout","message":…}
:- module(workbook_check, [main/0]).
:- use_module(library(time)).
:- use_module(workbook_load).

time_limit_seconds(5).

main :-
    set_stream(user_output, buffer(line)),
    set_stream(user_output, encoding(utf8)),
    set_prolog_flag(stack_limit, 268435456),
    current_prolog_flag(argv, Argv),
    append(_, [Tests|Students], Argv), sub_atom(Tests, _, _, 0, 'wb_tests.pl'), !,
    findall(Ok, (member(Student, Students), wb_load(user:Student, Ok)), Oks),
    (   \+ memberchk(false, Oks)
    ->  format("~N@@WB-TESTS@@~n"),
        wb_load(wb_checks:Tests, TestsOk),
        (   TestsOk == true
        ->  run_all
        ;   true
        )
    ;   true
    ).

run_all :-
    (   current_predicate(wb_checks:check/2)
    ->  forall(clause(wb_checks:check(Name, Spec), true), run_one(Name, Spec))
    ;   true
    ).

run_one(Name, Spec) :-
    time_limit_seconds(Limit),
    catch(call_with_time_limit(Limit, verdict(Spec, Status, Message)), E, caught(E, Limit, Status, Message)),
    emit(Name, Status, Message).

caught(time_limit_exceeded, Limit, timeout, Message) :- !,
    format(string(Message), "no answer after ~d seconds (is there an infinite loop?)", [Limit]).
caught(error(existence_error(procedure, PI), _), _, error, Message) :- !,
    strip_module(PI, _, Plain),
    format(string(Message), "not implemented yet: ~q", [Plain]).
caught(E, _, error, Message) :-
    wb_message_text(E, Message).

verdict(holds(Goal), Status, Message) :-
    (   once(wb_checks:Goal)
    ->  Status = pass, Message = ""
    ;   Status = fail,
        format(string(Message), "this should succeed, but it fails:\n  ~q", [Goal])
    ).
verdict(fails(Goal), Status, Message) :-
    (   once(wb_checks:Goal)
    ->  Status = fail,
        format(string(Message), "this should fail, but it succeeds:\n  ~q", [Goal])
    ;   Status = pass, Message = ""
    ).
verdict(equals(Var, Goal, Expected), Status, Message) :-
    (   once(wb_checks:Goal)
    ->  (   Var =@= Expected
        ->  Status = pass, Message = ""
        ;   Status = fail,
            format(string(Message), "expected: ~q\n     got: ~q", [Expected, Var])
        )
    ;   Status = fail,
        format(string(Message), "expected: ~q\n     but the goal has no solution", [Expected])
    ).
verdict(solutions(Var, Goal, Expected), Status, Message) :-
    findall(Var, wb_checks:Goal, Found),
    msort(Found, A),
    msort(Expected, B),
    (   A == B
    ->  Status = pass, Message = ""
    ;   Status = fail,
        format(string(Message), "expected the solutions: ~q\n                  got: ~q", [Expected, Found])
    ).

emit(Name, Status, Message) :-
    format("~N@@WB@@{\"name\":"),
    json_string(Name),
    format(",\"status\":\"~w\",\"message\":", [Status]),
    json_string(Message),
    format("}~n").

json_string(Text) :-
    format(string(S), "~w", [Text]),
    string_codes(S, Codes),
    put_char('"'),
    forall(member(C, Codes), json_code(C)),
    put_char('"').

json_code(0'") :- !, write('\\"').
json_code(0'\\) :- !, write('\\\\').
json_code(10) :- !, write('\\n').
json_code(13) :- !, write('\\r').
json_code(9) :- !, write('\\t').
json_code(C) :- C < 32, !, format("\\u~|~`0t~16r~4+", [C]).
json_code(C) :- put_code(C).
