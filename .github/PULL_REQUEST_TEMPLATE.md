## What

<!-- What does this PR change, and why? -->

## Checklist

- [ ] Conformance suite passes locally (`node conformance/run.mjs -- ...`)
- [ ] No DB driver imported outside an adapter file
- [ ] Errors use `isError: true` with a stable prefix (`read-only:`, `timeout:`, `unknown table:`, `multi-statement:`)
- [ ] No secret can reach stdout/stderr (new config or logging paths only)
