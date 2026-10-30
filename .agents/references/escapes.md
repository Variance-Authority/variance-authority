# Escapes

Ideas that passed, or would have passed, an idea review and were later shown
not to belong. Each is kept as the question that would have stopped it before
any code was written, with the pull requests it cost. The `occam` agent asks
every one of them in its idea mode. [Refine](refine.md#the-idea-loop) says
when an entry is added.

1. **Does a neighbour's tool already own the question?** A language's own
   server or checker answers type and member questions, and variance hands
   them over rather than copying them. #423, #424, #439.
2. **Does it refine a path the project has stopped refining?** Coverage is the
   selector; a relation walk is not made finer. #432.
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
