% Loads a student's file and reports errors and warnings in a form the server
% can parse, instead of the usual text meant for a terminal:
%
%   @@WB-DIAG@@<severity><TAB><file><TAB><line><TAB><column><TAB><message>
%
% Newlines in the message are written as \x01.
:- module(workbook_load, [wb_load/2, wb_message_text/2]).

:- dynamic capturing/0.
:- dynamic seen_error/0.

:- multifile user:message_hook/3.
:- dynamic user:message_hook/3.

user:message_hook(Term, Kind, Lines) :-
    capturing,
    severity(Kind, Severity),
    report(Term, Severity, Lines).

severity(error, error).
severity(warning, warning).

report(Term, Severity, Lines) :-
    ( Severity == error -> assertz(seen_error) ; true ),
    location(Term, File, Line, Column),
    lines_text(Lines, Text),
    split_string(Text, "\n", "", Parts),
    atomic_list_concat(Parts, '\x01\', Message),
    format("~N@@WB-DIAG@@~w\t~w\t~d\t~d\t~w~n", [Severity, File, Line, Column, Message]).

location(error(_, file(File, Line, LinePos, _)), File, Line, Column) :-
    integer(LinePos), !,
    Column is LinePos + 1.
location(error(_, file(File, Line, _, _)), File, Line, 0) :- !.
location(_, File, Line, 0) :-
    source_location(File, Line), !.
location(_, '', 1, 0).

lines_text(Lines, Text) :-
    with_output_to(string(Text), print_message_lines(current_output, '', Lines)).

%!  wb_message_text(+Term, -Text) is det.
%   The text SWI-Prolog would print for an error term.
wb_message_text(Term, Text) :-
    catch(( message_to_codes(Term, Lines), lines_text(Lines, Raw) ), _, fail), !,
    Text = Raw.
wb_message_text(Term, Text) :-
    format(string(Text), "~q", [Term]).

message_to_codes(Term, Lines) :-
    '$messages':translate_message(Term, Lines, []).

%!  wb_load(:File, -Ok) is det.
%   (Re)loads File. Ok is false when it produced an error.
wb_load(File, Ok) :-
    retractall(seen_error),
    setup_call_cleanup(
        assertz(capturing),
        catch(load_files(File, [silent(true)]), E, print_message(error, E)),
        retractall(capturing)),
    ( seen_error -> Ok = false ; Ok = true ).
