---
"@variance-authority/sense": patch
---

`variance index` waits on Watchman for about a second at most, and lists with
git when the watch has not answered by then. A watch still crawling a fresh
worktree, or still catching up after a large branch switch, no longer holds the
update: the clock is taken without a sync, and whether the watch has caught up
is asked beside git's listing, so only a watch that has caught up gives the next
update its clock. Under a crawling watch, Watchman's part of a fresh index falls
from about 0.8 s to about 0.13 s on Kibana and from about 1.8 s to about 0.13 s
on Firefox, the same as with no watch. A switch 200 commits away on Kibana
falls from about 9.9 s to about 5.9 s for the run. A settled watch still
vouches for an unchanged checkout with no git listing.
