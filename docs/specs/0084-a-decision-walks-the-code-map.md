# Spec 0084 — a decision walks the code map

**Missing:** a model that chooses among supplied answers is not connected to
the code map. There is no controller that scores local menus in batches, keeps
several routes alive, backs out of dead ends, or returns the exact graph path to
the agent. A generic LLM makes those navigation decisions one tool call at a
time instead.
**Built on:** [spec 0083](0083-the-code-map-offers-choices.md) (complete,
bounded menus), the published source index and code map, and the case recording
where one exists. This is a separate consumer of orientation data, not a change
to what `orient --files` accepts or claims.

## Purpose

The controller uses a local decision model for the narrow judgment that the
graph cannot make: among these real places, which are worth inspecting for the
task? The graph owns the places and relations. The model returns scores over
the supplied IDs, including `none of these`. The agent receives paths and
source locations to inspect, and owns the interpretation, edit and tests.

No model generates a next action, file path, explanation or graph edge. The
model interface is a typed choice over a menu, so a different local decision
model can be evaluated against the same menus and task set. No search sends
source to an external model service.

## One local decision

The decision input is the task, current node, direction, one menu from spec
0083, and one evidence view. It has no path transcript. When the controller
advances to a new node, the old page leaves the model input. The controller
alone keeps visited nodes, alternative choices and exact paths.

Decisions for distinct nodes and evidence views are independent inputs. The
controller may prepare menus for candidate nodes from the published graph and
score them in one batch before it knows which route it will keep. A choice
does not have to cause a new model request. Batch size is bounded by the
selected model and runtime, and the measured cost includes preparing menus,
encoding them, model execution and assembling the routes.

At a node, the controller asks the same choice through the **name and place**
and **relation** views. It may add a third view only when it contains a
different owner-provided signal, such as a recorded case or a known stack-trace
location. Rewording one view three times is not three sources of evidence.
Each view is scored independently over the same IDs. The union of their top
two non-`none` choices supplies the next routes; agreement affects scheduling,
but a high score in one view is not averaged away by another. Scores order
inspection. They are neither a probability that a file is correct nor proof
that an unchosen route is irrelevant.

## Branches and stopping

The controller can keep four active routes, including routes through both
import directions. At a junction it stores the remaining scored options. A
selected `none`, a leaf with no further indexed action, or a cycle ends only
that route. The controller resumes the nearest untried option or another
active route without asking the model to reconstruct the past. A promising
package or file leaf is handed to indexed file discovery and then to the
agent, with the exact path that found it.

`None` is local to one menu page. The controller reads all pages of a node
before treating the node as exhausted, unless it reports a budget limit. If
every route is exhausted, it produces another start from the map or indexed
search when one exists. If no start or scored route can be read, it reports
the reason and the uninspected scope. It never concludes that the repository
contains no answer from model scores.

The experiment uses a budget of 50 scored menu-view decisions per task.
Pre-scoring a menu counts against it even if the route is not selected. The
budget is not a graph depth cap and does not turn unvisited nodes into negative
evidence. The production budget remains a measured choice.

## Handoff

The answer names the index generation, model identity and version, starts,
chosen areas, packages and files, every traversed edge and direction, and
which view selected each route. It distinguishes indexed structural evidence,
recorded execution, model scores and unread scope. The agent can inspect the
named files and ask `orient --files` about them without repeating the search.
An unavailable model or failed batch is reported as unavailable; the existing
deterministic `search`, `symbol`, `grep` and `orient` commands remain usable.

## What would discharge it

1. A controller exercised against a fixed scoring adapter: two top choices
   create separate routes; four routes score in a batch; `none` closes only its
   page; an exhausted path backs out to a saved alternative; cycles and budget
   exhaustion leave no false negative.
2. An adapter for at least one local choice model. Pin the model weights,
   runtime, input format and option order for a recorded evaluation. The CI
   path can execute that adapter without an outbound model call and reports
   model absence separately from a healthy `none` choice.
3. A held-out task set with reviewed target files and a code map built from
   each task's pre-change checkout. Include tasks with no lexical name match,
   misleading sibling areas, several valid routes, and no answer in the
   indexed scope. Report target-area, package and file recall within 50
   decisions, first useful hit, budget exhaustion and false local `none`.
4. Run the same tasks with indexed lexical search, one evidence view, and two
   views at equal decision budgets. The second view earns its place only when
   it improves recall without losing a target the first view found. Record
   disagreements and the route that resolved each one.
5. Measure warm end-to-end latency on Kibana and the seven-copy MUI corpus,
   plus a local Mac and a CPU CI runner, including model startup separately.
   Report p50, p95, batch occupancy, model time, menu time and handoff size.
   A throughput figure for independent decisions is not substituted for the
   time one task takes to finish.

The experiment does not claim that a small model understands a codebase. It
tests whether fast choices over the graph's actual options find useful code
more often, within the same budget, than the indexed and single-view routes.
