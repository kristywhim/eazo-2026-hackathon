---
name: GitHub push after approval
description: After user approves a version of eazo-user-vote, execute git add/commit/push to GitHub
type: feedback
---

After the user approves a version of the eazo-user-vote page, always execute the git commands to push to GitHub (git add, git commit, git push). Do not just remind — actually run the commands.

**Why:** The user made a git repo for eazo-user-vote and expects the push to happen as part of the approval flow.

**How to apply:** When the user says something like "looks good", "approved", "ship it", or "push this" on the eazo-user-vote project, immediately run git add + commit + push.
