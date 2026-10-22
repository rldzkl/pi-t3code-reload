# Project plan

## Agreed scope

Create a shareable Pi extension that reloads Pi from T3 Code, released under MIT on npm and GitHub as `pi-t3code-reload`. The local checkout directory remains `pi-t3-reload`. On 2026-10-22 the user approved the initial commit, public GitHub repository, and npm publication of 0.1.0.

## Acceptance

- `/t3-reload` executes Pi's reload API without a model call. The package does not register `/reload`.
- Busy sessions, pending messages, and overlapping reload requests are refused without aborting work. The overlap guard persists into the reloaded runtime.
- Reload errors propagate, and the package's guard resets. Pi 1.4.0 cannot retry a reload that fails after it shuts down the old runtime, so the session must restart.
- The handler never uses its context after its own `await ctx.reload()`. During another reload, it touches a stale context only inside a caught refusal notice.
- Reload preserves the session ID and existing entries, loads changed extension code, and supports repeated reload.
- T3's Pi MCP bridge remains usable after reload.
- The npm package includes only its manifest, extension, README, and license.

Risk: medium. The command crosses the Pi runtime and T3 adapter lifecycle boundary.

## Decisions

- 2026-10-22: ship only `/t3-reload`. Pi 1.4.0's interactive terminal UI has a built-in `/reload`. Source inspection of `interactive-mode.js` shows that a package command with that name triggers a startup conflict warning. A second extension command with the same name would make Pi rename both to `reload:N`.
- T3 0.1.1 needs no adapter change. Its composer reserves only `/model`, `/plan`, and `/default`, and it forwards other slash commands to Pi through RPC `prompt`.

## Evidence

### Tested versions

- Pi 1.4.0 on Windows (Node.js 24.13.1 and 24.20.0) and Linux (Node.js 26.8.2).
- T3 Code desktop 0.1.1 on Windows. The VPS T3 service also reports v0.1.1, but T3 was exercised only on Windows.

### T3 integration (Windows, disposable thread)

The disposable thread loaded this package from its scratch folder's `.pi/settings.json`, with a probe extension logging Pi PID, session ID, entries, and commands. Most checks ran on the earlier two-command build, which used the same handler for `/reload` and `/t3-reload`. The final row used the single-command build.

| Check | Result |
| --- | --- |
| Command-only settlement | Runs completed without model calls and displayed `Pi runtime reloaded.` as a T3 notice. |
| Repeated reload and history | Four reloads ran in the same Pi process and session. Entries were retained, and the model later recalled a sentinel created before reload. |
| Changed extension code | After reload, the probe notice changed from `integration-probe-v1` to `integration-probe-v2`. |
| MCP bridge | After an isolated reload with no intervening resume, T3's `t3_thread_configuration` MCP tool still worked. |
| Busy refusal | `/reload`, steered during a 25-second Bash run, returned the busy warning. No reload occurred, and the turn completed normally. |
| Manual composer run | The user ran `/t3-reload` from the T3 chat box. It completed in about 0.7 s, retained all 31 entries, and listed only `t3-reload`. |

The OpenAI provider reached its usage limit during testing, so the MCP and busy checks used Pi's Anthropic Sonnet model.

### Package checks

Each run used `npm ci --ignore-scripts --offline`, `npm test`, `npm run test:rpc` with `PI_TEST_CLI` set to the host's Pi CLI, and `npm run pack:check`. Remote runs used temporary copies that were deleted afterward.

| Environment | Build | Result |
| --- | --- | --- |
| Local Windows, Node 24.13.1 | final | 9/9 unit, 2/2 real RPC, 4 package files |
| VPS Linux, Node 26.8.2 | final | 9/9 unit, 2/2 real RPC, 4 package files |
| Mesh Windows, Node 24.20.0 | final | 9/9 unit, 2/2 real RPC, 4 package files |

All three final runs produced package shasum `579de2dc102e1b138fc83cfeca8fafcec4e0c86a`. Earlier builds passed the tests that existed at the time on all three hosts. The real RPC overlap test failed on the pre-review build, as expected, and passed on the fixed builds, including three consecutive local runs.

The real RPC test uses an isolated temporary Pi profile with no MCP, skills, context files, tools, or model calls.

### Independent review (2026-10-22)

Two fresh read-only Claude Opus 5.5 reviewers, one for standards and one for spec, checked a frozen snapshot. They reproduced these findings against real Pi 1.4.0:

- Overlap: the reloaded extension copy started with a new guard. A second `/t3-reload` sent while the new runtime's `session_start` handlers were running started a nested reload. Fixed with a process-global `Symbol.for` guard that is cleared in `finally`. The new real RPC regression test fails on the old build because two reloads ran, and it passed three consecutive runs on the fix.
- Retry: Pi shuts down the old runtime before the reload steps that can fail, so a failure after that point leaves stale contexts. This is a Pi constraint, so the README and acceptance criteria now say to restart the session.
- Lower-severity items fixed: overlap unit assertions, the leftover two-name command object, README claims that came from the earlier build, and real RPC coverage now using a persisted temporary session.
- Accepted and documented: Pi does not count a user shell command started over RPC (`bash`) as busy, so this package does not block reload while one runs.

Round 2 had no blocker, high, or medium findings. Fixes for low findings:
- A second request during reload now gets its own message, `Reload already in progress.`.
- If Pi routes that request to the invalidated copy, the refusal is quiet.
- A code comment states the guard is process-wide.
- The README says to restart if a reload never completes.
- Unit tests reset the guard.
- Docs no longer imply that T3 checks ran on the post-review build.

Round 3 had no blocker, high, or medium findings. Both reviewers found one low issue: the usage check ran before the reload guard, so `/t3-reload extra` during reload still touched a stale context. The guard now runs first. The stale-context unit test covers calls with and without arguments, counts reload and notice calls, and cannot hang if the guard regresses. Two documentation wording issues were also fixed. The one-line reorder followed both reviewers' prescribed fix and was not sent for a fourth review. Mutation checks confirmed the unit tests fail cleanly if the order reverts, the refusal's `try`/`catch` is removed, or the guard is removed.

### Global install (2026-10-22, final build)

- Backed up `~/.pi/agent/settings.json` to `settings.json.bak-pi-t3-reload-20261022-144925`, then ran `pi install C:/Users/Ridzki/Documents/Repositories/Misc/pi-t3-reload`. Only the `packages` entry changed; Pi stores the package as a path relative to the agent directory.
- Fresh disposable T3 thread `mcp:e099f676-b8b8-4bb0-80f2-1f0362aff61b` (Pi with Anthropic Sonnet) showed:
  - `/t3-reload` worked as the first message and again later. Both runs displayed `Pi runtime reloaded.` without model calls.
  - T3's `t3_thread_configuration` MCP tool worked before and after reload. After reload, the model recalled a sentinel created earlier.
  - `/t3-reload` sent during a 20-second Bash run showed the busy warning. Bash finished, and the turn completed.
- Rollback: run `pi remove <package-path>` or restore the backup. Restart already-running sessions to unload the package.

## Remaining

The disposable T3 fixture thread is archived, which stopped its Pi process, and its scratch folder is deleted.

- Untested: T3 on Linux or macOS.
- Names: the GitHub repository and npm package are both `pi-t3code-reload`. On 2026-10-22, the repository name was unused under account `rldzkl`, and that npm name was unpublished.
- npm publication requires the owner to log in to npm on this machine; `npm whoami` returned `ENEEDAUTH`.
- After publication, consider switching the global install from the local path to `npm:pi-t3code-reload`.

## Release

Version 0.1.0 has `private` removed and adds repository metadata. Publish it with `npm publish` after `npm run pack:check` confirms four files. Local removal uses `pi remove <source>`; already-loaded sessions need a restart to stop using the extension.
