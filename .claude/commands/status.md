---
description: Where delivery actually stands — the ledger checked against the repository, not quoted from it.
---

Tell me where delivery actually stands. $ARGUMENTS

Do not just read `docs/delivery/ledger.json` back to me. Check it:

```sh
node --experimental-strip-types --test tests/delivery-ledger.test.ts tests/conventions.test.ts
git log --oneline origin/main -5
git status --short
```

Then look for what a ledger cannot know:

- branches ahead of `main` with no open pull request — that is how twenty-one
  commits of finished work once went unnoticed;
- open pull requests, and whether their checks are green;
- any feature marked `todo` whose work looks already done, or `merged` whose
  files are missing.

## Report

| | |
|---|---|
| Position | merged / in review / to do, and per phase |
| Next up | the first `todo` whose prerequisites are all `merged` |
| Blocked | anything waiting on a person, a merge, or a real Postgres |
| Drift | anything where the ledger and the repository disagree |

Be specific about the gates: they report `advisory-only` because the gold set
holds 5 verified cases against 50, so no phase gate has ever bound. Say that
plainly rather than reporting a pass. `docs/gates/gate-debt.md` is the register.

Keep it short. If everything agrees, say so in a line and name the next feature.
