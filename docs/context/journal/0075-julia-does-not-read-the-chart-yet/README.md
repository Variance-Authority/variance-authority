# Lab material for journal 0075

These are the scripts, inputs and rank files behind
[the journal entry](../0075-julia-does-not-read-the-chart-yet.md).

- [`notebook.md`](notebook.md) is the run-by-run checkpoint. Each run was
  arranged and its readbacks written down before it ran. It also holds the
  earlier package-routing runs that led here.
- [`traces.md`](traces.md) holds the hand traces of eight specs through the chart.
- `eval.py` is the shared head: the gold labels, the cleaned specs, BM25 and
  the direct ranks. `trN.py` is run N, and `ranks_trN.json` is its output.
- `gold.json` holds the owners of the 44 specs, and `q_0*.json` the 285
  synthetic proposals.

The scripts expect `S` to point at a scratch directory holding `dom/`, and a
Python environment with `julia_mlx`. Model weights are not included.
