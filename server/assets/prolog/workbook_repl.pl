% The interactive session behind the interpreter panel.
%
% SWI-Prolog's own toplevel is made for a terminal: it asks what to do after
% every solution. This one reads one query per line, prints the solutions, and
% ends every answer with a sentinel, so the server knows when it is idle.
:- module(workbook_repl, [main/0]).
:- use_module(library(readutil)).
:- use_module(workbook_load).

max_solutions(10).

main :-
    prompt(_, ''),
    set_stream(user_output, buffer(line)),
    set_stream(user_output, encoding(utf8)),
    set_stream(user_input, encoding(utf8)),
    set_prolog_flag(stack_limit, 268435456),
    on_signal(int, _, workbook_repl:interrupted),
    loop.

interrupted(_) :- throw(wb_interrupted).

loop :-
    idle,
    catch(step(Continue), wb_interrupted, ( format("~NInterrupted.~n"), Continue = true )),
    (   Continue == true
    ->  loop
    ;   halt
    ).

idle :-
    format("~N@@WB-PROMPT@@"),
    flush_output(user_output).

step(Continue) :-
    read_line_to_string(user_input, Line),
    (   Line == end_of_file
    ->  Continue = false
    ;   handle(Line),
        Continue = true
    ).

handle(Line) :-
    string_concat("@@WB-LOAD@@ ", File, Line), !,
    wb_load(user:File, _).
handle(Line) :-
    split_string(Line, "", " \t\r", [""]), !.
handle(Line) :-
    catch(term_string(Goal, Line, [variable_names(Bindings)]), Error, true),
    (   nonvar(Error)
    ->  report_error(Error)
    ;   catch(solve(Goal, Bindings), E, report_error(E))
    ).

report_error(wb_interrupted) :- !, throw(wb_interrupted).
report_error(error(existence_error(procedure, PI), _)) :- !,
    strip_module(PI, _, Plain),
    format("~NERROR: Unknown procedure: ~q~n", [Plain]).
report_error(E) :-
    wb_message_text(E, Text),
    string_lines_trimmed(Text, Trimmed),
    format("~NERROR: ~s~n", [Trimmed]).

string_lines_trimmed(Text, Codes) :-
    split_string(Text, "", " \n", [Trimmed]),
    string_codes(Trimmed, Codes).

solve(Goal, Bindings) :-
    State = solutions(0),
    max_solutions(Max),
    (   call_cleanup(user:Goal, Det = true),
        arg(1, State, N0),
        N is N0 + 1,
        nb_setarg(1, State, N),
        print_bindings(Bindings),
        (   Det == true
        ->  format(".~n")
        ;   N >= Max
        ->  format(" ;~n... (first ~d solutions shown)~n", [Max])
        ;   format(" ;~n"),
            fail
        )
    ->  true
    ;   format("false.~n")
    ).

print_bindings(Bindings) :-
    visible(Bindings, Visible),
    (   Visible == []
    ->  format("true")
    ;   print_pairs(Visible, Bindings)
    ).

visible([], []).
visible([Name=Value|T], Out) :-
    (   ( sub_atom(Name, 0, 1, _, '_') ; var(Value) )
    ->  Out = Rest
    ;   Out = [Name=Value|Rest]
    ),
    visible(T, Rest).

print_pairs([Name=Value], All) :- !,
    print_pair(Name, Value, All).
print_pairs([Name=Value|T], All) :-
    print_pair(Name, Value, All),
    format(",~n"),
    print_pairs(T, All).

print_pair(Name, Value, All) :-
    format("~w = ", [Name]),
    write_term(Value, [quoted(true), portray(true), numbervars(true), max_depth(0), variable_names(All)]).
