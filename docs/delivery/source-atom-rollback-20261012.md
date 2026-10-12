# Source atom rollback and performance direction

The user requested reverting the source atomisation, exact dictionary
deduplication and compact audit-context experiment on 12 October 2026. Runtime
source, benchmark scripts and tests are restored exactly to `89ad484`, before
PR43/44. Original Google/OpenRouter defaults, independent audits and earlier
PR41/42 publication fixes remain. The experimental setting is removed.

Prior results and raw responses remain as historical evidence. Stored completed
runs are retained. No database migration, destructive data reset or paid rerun is
part of this rollback. Runtime restoration is being verified before release.

## Learning

The same-source campaign increased mean processing from 108.031 to 165.521
seconds and recorded model cost from $0.863104665 to $1.348871826. Input tokens
rose 36%, output tokens 66%, and paid calls rose from 49 to 59. Newly triggered
coverage repairs and their independent checks cost $0.19133801, accounting for
39% of the cost increase. Context encoding saved little: 827 synthesis bytes
for T-Mobile, with raw evidence retained for the other two videos.

The extra structured generation did not pay for itself. Shorter prompts are not
an adequate success metric; total generated tokens, sequential dependencies,
repair frequency and published material coverage must all be measured. These
single observations also include earlier publication changes, so they do not
isolate each optimisation's causal effect.

Further recommendations and final rollback verification will be recorded here
after reviewing the restored execution path.
