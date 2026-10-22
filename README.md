# pi-t3code-reload

A Pi extension that adds `/t3-reload`, so you can reload Pi from T3 Code without restarting the app. It calls Pi's reload API in the running session.

Tested with Pi 1.4.0 and T3 Code 0.1.1 on Windows. The package tests also pass on Linux. T3 has not been tested on Linux or macOS.

## Install

```sh
pi install npm:pi-t3code-reload
```

This adds the package to your Pi settings. Sessions that are already running load it after a restart. New T3 threads load it immediately.

To remove it:

```sh
pi remove npm:pi-t3code-reload
```

## Usage

Send `/t3-reload` in a T3 thread that uses Pi. Pi reloads its extensions, skills, prompts, themes, context files, and settings in the same session, and T3 shows "Pi runtime reloaded." The conversation history stays in place, and no model call is made.

Reload does not replace the running Pi executable. Restart the session after updating Pi itself.

The command refuses to run while Pi is working, has queued messages, or is already reloading. It never aborts work or retries on its own. Send it again once the session is idle. Pi does not count a shell command started over RPC (`bash`) as work, so that does not block a reload.

If a reload fails after Pi has shut down the old runtime, the session cannot reload again, and extensions stop working until you restart the session. Restart it also if a reload never finishes.

The package does not register `/reload`. Pi's terminal UI already has that command, and a second `/reload` would trigger a conflict warning. The terminal UI does not need this package.

## Development

Requires Node.js 22.19 or later and npm. The extension has no runtime dependencies and no build step. Pi supplies the extension API.

```sh
npm ci
npm test
npm run pack:check
pi --extension ./index.ts
```

`npm run test:rpc` runs real Pi in RPC mode with a temporary profile, offline, without MCP servers or model calls. It checks command discovery, loading of changed extension code, repeated reloads, session history in a saved session, and refusal of a second reload while the first is still starting the new runtime.

Set `PI_TEST_CLI` to Pi's JavaScript entry point, not its shell launcher:

```sh
PI_TEST_CLI=/path/to/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js npm run test:rpc
```

PowerShell:

```powershell
$env:PI_TEST_CLI = 'C:\path\to\pi-coding-agent\dist\bundle\cli.js'
npm run test:rpc
```

Without `PI_TEST_CLI`, the RPC test is skipped. The unit tests do not need Pi. `docs/PLAN.md` records the test evidence and design decisions.

This is an independent extension, not an official T3 Code or Pi package.

## License

[MIT](LICENSE).
