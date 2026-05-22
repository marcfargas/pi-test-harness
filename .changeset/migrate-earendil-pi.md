---
"@marcfargas/pi-test-harness": minor
---

Migrate the harness to the current `@earendil-works/*` Pi packages and require Pi `>=0.74.0`.

This drops direct support for the deprecated `@mariozechner/*` Pi package names, updates the harness for current Pi session/tool APIs, and adds CI coverage across Linux and Windows against the latest patch releases of the last two supported Pi minor lines.
