---
"@variance-authority/sense": patch
---

Reading the recorded text in a partial clone now works on Git before 2.44, including the 2.43 that Ubuntu 24.04 ships. That Git exits at the first object it would have fetched instead of answering `missing`, and every module read as unverified; now the paths are fetched together in one request.
