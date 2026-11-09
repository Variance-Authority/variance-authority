# Escapes

Ideas that passed, or would have passed, an idea review and were later shown
not to belong. Each is kept as the question that would have stopped it before
any code was written, with the pull requests it cost where it cost any. The `occam` agent asks
every one of them in its idea mode. [Refine](refine.md#the-idea-loop) says
when an entry is added.

1. **Does a neighbour's tool already own the question?** A language's own
   server or checker answers type and member questions, and variance hands
   them over rather than copying them. #423, #424, #439.
2. **Does it refine a path the project has stopped refining?** Coverage is the
   selector; a relation walk is the bridge from file graphs and is not made
   finer: no hop narrowing, per-export reach or barrel-specific work. In docs,
   file-use is the safe default and region-use the sharpest, and a claim that
   coverage beats the graph carries a measured number. #432.
3. **Does it keep alive a surface that is being removed?** A fix to a format,
   flag or command whose caller is going away has no caller worth fixing.
   #189, #190.
4. **Does it serve a case the specs mark unsupported?** A behaviour guarded
   only by framework internals and `FIXME`s for a precondition the spec rules
   out. #164.
5. **Is it downstream of where the cause lives?** A knob, hook or repair that
   an earlier stage would make unnecessary treats the symptom. #201, #356,
   #459.
6. **Does it pair things by name, order or likeness where the record is
   exact?** A different name is a different file, and the diff decides what
   changed. #321.
7. **Does it answer without a question?** A required argument stays required: a
   place or scope alone is a dump. Each answer prints the arguments of the
   narrower question instead.
8. **Does it score what is declared?** A role check is reachability against a
   declared tag: an untagged helper is no finding, and no report ranks a symbol
   by the balance of its callers.
9. **Does it make variance a debugger?** Variance explains why a run behaved as
   it did. Stepping and runtime values at any expression are out of scope, and
   extra fidelity is an opt-in layer an agent listens to, never part of the
   recording run.
10. **Does a selection ride the command line?** A large change exceeds the OS
   argument limit. A selection reaches a runner through runner integration, from
   the seams that exist.
11. **Does it explain renders or commits?** Why a component rendered has no use
   case, and what happened during a commit is too much data to operate with. The
   material is the diff and the code; a competitor's render-cause feature is out
   of scope, not a gap.
12. **Does it turn observed state into planned surgery?** A sensor reports what
   varies between the declared chart and the measured graph. An undeclared
   import is not a planned change, and a planner may read the report as
   evidence.
13. **Does it take a tool's part the record cannot answer?** A neighbour is
   absorbed only through the record: a red-first gate or a record-drawn map,
   never a second source of truth beside the test, a driver loop or an editor
   canvas.
14. **Did it happen as told?** A claim that somebody hit the problem names the
   run or the transcript line where they did; without one, the brief claims no
   harm and stands on an ask or a reproduction. A brief built on an agent's list
   of its own complaints said the agent was misled, and its transcript shows it
   naming the cause and moving on. #1202, #1205.
