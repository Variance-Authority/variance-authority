---
'@variance-authority/cli': minor
'@variance-authority/observe': patch
---

A pull-request comment now groups subjects that have no baseline under one reason instead of listing each subject as its own cause. The reason for `new` and `incomparable` no longer repeats the subject id, which every line already shows: `no baseline under this renderer; nothing to compare against`.

`variance report --format html --embed-images` writes the report as one file with its images inside it, so it opens anywhere, including on a phone. On GitHub Actions, upload it with `actions/upload-artifact@v7` and `archive: false`, and the artifact link opens the page instead of downloading a zip.

`variance comment --to-accept <text>` tells the reviewer how to accept in your repository. When `--run-url` is given, the comment links the report and no longer prints the `variance report --subject <id>` command, which needs the report on disk. The GitHub action takes `to-accept` and `report-page` inputs. `report-page` writes, uploads and links that page.

The comment now fits a phone's first screen: the count, the leading cause and its file, the report link and how to accept, then any font warning as an alert. The causes, the collateral count, what was skipped and what painted the images sit under one `<details>` fold.

In the HTML report, each subject's commands (`accept`, `again`, `alone`, `report --subject`) sit folded under **Commands for a checkout**, each with a line saying what it does. The mark on a subject whose inspection found nothing reads `no defects found`. On a narrow screen the header scrolls away instead of staying pinned.

On a phone, the HTML report shows each subject with its reason and images, and nothing else. The grouped changes, region tables, commands, composition, history, settled subjects, what was not observed and coverage stay on wider screens. A line at the top names the ones this report holds, so you know there is more.

`variance comment --image-root <url>` shows the leading cause's before and after on the comment's first screen, and each further cause's pair in the fold. The address is where you published the report's directory. The GitHub action takes an `image-ref` input that pushes those images to a ref outside `refs/heads/`, as one commit, and links them by that commit.
