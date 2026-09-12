# The codec was chosen before the floor moved

The columns compressed with brotli at quality 4, and the reason was written down
at the top of `columns.ts`: `zlib.zstdCompressSync` arrived in Node 22.15 and
the package supported Node 22. That is a support decision wearing a
performance decision's clothes, and it had never been costed.

The question that exposed it was a different one. [0043](0043-the-index-was-being-rebuilt-to-change-ten-files.md)
left the layer stage at 60% native, which is to say 60% brotli, and the obvious
next move was to compress less hard. Sweeping quality at twenty thousand
modules says that move is a bad trade:

```
q    size        encode    layer    decode   200 probes
0    12.69 MB     670 ms   623 ms   933 ms     8.1 ms
1    11.84 MB     729 ms   613 ms   921 ms     8.1 ms
2    10.87 MB     824 ms   800 ms   891 ms     8.2 ms
4    10.60 MB     938 ms   881 ms   904 ms     8.0 ms
11   9.77 MB    19891 ms 19928 ms   879 ms     8.3 ms
```

Decompression does not move. Not at any setting — 871 to 933 milliseconds to
decode, eight to read two hundred strings, whatever the writer paid. So the
whole trade is a writer's milliseconds against bytes that every reader carries,
including across the wire when an index is shared, and quality 1 wanted 11.7%
more file for 268 milliseconds. Quality 4 was also a real optimum rather than a
default: 5, 6 and 9 all produced a *larger* file than 4 did.

So the knob was the wrong thing to turn, and the interesting number was
somewhere else.

## Two kinds of run

A section's runs are not one kind of data. A numeric column is delta coded, then
zigzagged, then varint encoded, and what reaches the codec is a dense stream of
small integers. The string blob is file paths and hex digests. Measured apart,
over the bytes each is actually handed:

```
                     brotli q4          zstd
numeric (varints)   109 ms  3.035 MB    l6:  73 ms  3.047 MB
byte columns         16 ms  0.260 MB    l6:  16 ms  0.247 MB
strings.off           7 ms  0.014 MB    l6:   1 ms  0.015 MB
string blob         187 ms  7.169 MB    l1:  30 ms  7.083 MB
—————————————————   ———————————————     ———————————————————
                    319 ms 10.478 MB        120 ms 10.392 MB
```

The blob is the whole story. Brotli spent 187 of its 319 milliseconds there and
came out *larger* than zstd did in 30 — its static dictionary is tuned for
markup, and above quality 4 it made this blob bigger rather than smaller. Zstd
finds what there is to find at level 1 and nothing more above it.

The varints are the opposite: zstd wants level 6 on them, and gains nine
kilobytes across a whole snapshot between 6 and 9 for twice the time. So the
levels are two, one per kind of run, and the constants say which is which.

This is not a trade. It is 2.7x less compression time for a file 86 kilobytes
smaller, and decode falls from 111 to 104 milliseconds alongside.

The split is the whole finding, and it is why the record used to say zstd cost
three per cent more bytes. That was measured, and it was right: one level across
every run does cost about that, because no single level is right for both kinds.
The mistake was asking for one number.

## What the stage reads now

```
                                 before      after
encode                          1201 ms     802 ms
decode                           855 ms     820 ms
layer, over the columns          808 ms     642 ms
  of which the codec             410 ms     206 ms
  of which ours                  298 ms     291 ms
```

The layer stage is 3.1x the composition it replaces, up from 2.6x, and it is
still byte for byte the same file — `native.mjs` compares them and refuses
otherwise. It is now 50.3% native rather than 60.1%, which is the honest way to
read a codec getting out of the way.

## What it cost

`FORMAT` moved from 4 to 5. The run tag would have carried the difference on its
own — brotli was 1, zstd is 2, and the number is not reused — but a header that
answers first turns an unreadable byte deep in a section into a stated version,
and every caller already treats a snapshot it cannot read as one that is not
there. A build meeting last week's index re-encodes it rather than failing.

Six packages moved their floor from `>=22` to `>=22.15`: `sense`, and the five
that depend on it. A package that cannot run on 22.14 while declaring that it
can is a false statement, not a courtesy. CI does not catch this — its matrix
says `['22', '24']` and `setup-node` resolves 22 to the newest 22 there is — so
the floor is a claim the repository makes and does not test. It was equally
untested when it said `>=22`.

The support floor was the only thing holding the old codec in place, and nobody
had ever asked what holding it cost. It cost 199 milliseconds a run and 86
kilobytes a snapshot.
