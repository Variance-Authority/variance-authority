---
'@variance-authority/cli': minor
---

`Variance-Authority/action/review` takes `comment: 'false'`, which uploads the review and the badge's figure as the artifact `variance-review` instead of posting, and `from: variance-review`, which posts the comment, marks the diff and pushes the badge from a job that checks nothing out and runs none of the pull request's code. The job that runs the tests then needs `contents: read` alone, and the write token lives in a job no test can reach. One job with both still works.
