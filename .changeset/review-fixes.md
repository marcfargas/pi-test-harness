---
"@marcfargas/pi-test-harness": patch
---

Address code review findings for v0.4.0 standalone release.

- **Breaking**: Remove deprecated `call()`/`say()` DSL aliases (use `calls()`/`says()` instead)
- Fix diagnostic messages to reference current `calls()`/`says()` API names
- Fix release workflow for npm Trusted Publishers (`--provenance`)
- Record all mock UI method calls for assertion consistency (`setFooter`, `setHeader`, etc.)
- Scope playbook `toolCallCounter` to factory closure for concurrency safety
- Add `verifySandboxInstall()` test suite (4 tests with dummy extension fixture)
- Update package description to mention all three test layers
