# dsh-input-history

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-29%20passing-brightgreen.svg)](#development)

[中文](README.md) | **English**

Persistent prompt history for the DeepSeek Harness composer. Everything you send is remembered, so you can reach back through it with `↑` / `↓` — across restarts.

## Features

- Sent prompts are stored locally and survive a restart
- `↑` on an empty composer walks back through earlier entries
- `↓` walks forward again and restores an untouched draft at the end
- Repeated presses keep walking, so you never have to move the caret back to the start
- Editing a recalled entry hands the arrow keys straight back to the editor
- Blank input is ignored, repeats keep only the newest copy, and the list is capped at 200 entries
- Keys are left alone during IME composition
- Arrows carrying `Shift`, `Ctrl`, `Alt` or `Meta` are never intercepted
- Slash-command and `@`-mention popups keep their own arrow keys

## How it works

The Harness composer is a **Lexical `contenteditable`, not a `<textarea>`**. The plugin therefore never rewrites the DOM; it drives the shell's own composer API:

| Purpose | Interface |
| --- | --- |
| Read the current draft | the session input shell's `snapshot.draft` |
| Write the draft | the shell's `setDraft(text)` — the official programmatic write, which places the caret at the end |
| Follow the composer element | `shell.editor.registerRootListener(...)` |
| Yield keys to a popup | `shell.arbitrate(key, composing)` — only a `"pass"` verdict lets history act |
| Mount the per-session bridge | `conversation.input.left` / `conversation.input.right` (`list` slots, session scope) |

The key listener is installed on `document` in the **capture phase**, so it runs before the editor's own keymap; a consumed press calls `stopPropagation()` so the caret does not move as well.

An entry is recorded when the composer empties. The send button, the Enter key and queued steering all clear the draft through the same shell, so this is the one signal every send path shares.

## Compatibility

| | |
| --- | --- |
| Developed against | DSH Desktop `2.0.13` (Windows) |
| Client core | `@deepseek-ai/dsh@0.1.5-rc.2` |
| Client UI | `@deepseek-ai/dsh-client-ui-conversation@0.1.5-rc.2` |
| Platform | `web` (desktop and browser share one client) |
| Node | `>= 22` |

The plugin relies on the composer interfaces listed above (`conversation.input`, `setDraft`, `registerRootListener`, `arbitrate`). On an older Harness build without them it will **silently do nothing** rather than fail loudly.

## Installation

### 1. Register the plugin in a profile

Edit `%USERPROFILE%\.dsh\profiles\<profile>\package.json` in two places:

```json
{
  "dependencies": {
    "dsh-input-history": "link:/absolute/path/to/dsh-input-history"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-input-history"
      ]
    }
  }
}
```

### 2. Install

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
# replace <DSH install dir> with your own install location
node "<DSH install dir>\resources\app\node_modules\pnpm\bin\pnpm.cjs" install
```

The pnpm bundled with the desktop app lives at `resources\app\node_modules\pnpm\bin\pnpm.cjs` inside your install directory.

### 3. Restart DSH Desktop

### Use `link:`, not `file:`

This distinction matters:

| Protocol | Behaviour | After editing the source |
| --- | --- | --- |
| `file:` | pnpm **copies** the package into `node_modules` | Needs another `install`, or your edits are ignored |
| `link:` | Creates a junction to the source directory | Live — just restart |

With `file:`, `node_modules/dsh-input-history` is a real directory copy. Edit the source without reinstalling and the app keeps loading the old code — which looks exactly like "my changes do nothing".

### Do not install with npm

> **A DSH Desktop profile is managed by pnpm** (`nodeLinker: hoisted`). Running `npm install` rewrites `node_modules` to npm's own layout and prunes shared packages that other plugins depend on, which breaks the next start-up.
>
> Always use the bundled pnpm shown in step 2.

### Installing from a tarball

```powershell
npm pack
```

The resulting `.tgz` can be shared with others. Note that it is a **snapshot**, not a live link.

## Usage

1. Type into the composer and send.
2. Put the caret back in the composer.
3. Press `↑` to walk back through earlier prompts.
4. Press `↓` to walk forward again.
5. One more `↓` past the end restores the draft you had not sent yet.

## Storage

History lives only in the WebView's local storage:

```text
dsh-input-history:v1
```

Nothing is uploaded, and no server capability is needed (`lib/index.js` is an empty runtime entry). Clearing site data clears the history with it.

## Troubleshooting

**The arrow keys do nothing at all**

First confirm the profile is loading your code rather than a stale `file:` copy:

```powershell
$t = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-input-history"
Get-Item $t -Force | Select-Object LinkType, Target
Select-String -LiteralPath "$t\lib\client.js" -Pattern 'registerRootListener'
```

- `LinkType` should be `Junction` with `Target` pointing at your source directory; empty means it is a copy
- `registerRootListener` should match; no match means an old version is loaded

**`↑` recalls once, then stops responding**

Check the version is `>= 0.2.0`. `0.1.0` was written against `<textarea>` and can never fire in a Lexical composer.

**Start-up errors**

Check whether npm was ever used on the profile. In a healthy profile:

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
Test-Path package-lock.json                  # expect False
Test-Path node_modules\.package-lock.json    # expect False
```

If either exists, remove it and reinstall with pnpm.

## Development

```powershell
npm test
```

The suite covers three layers:

1. **History storage and the walk decision** — pure functions, no browser needed
2. **Caret boundary probes** — against a `Range` double (this proves the probe arithmetic, not real browser `Range` behaviour)
3. **The full key path** — from bridge mount through `registerRootListener` and `keydown` to `setDraft`, driven through the listener the plugin actually installs on `document`

The implementation is `lib/client.js`; all behaviour lives on the web client side.

## License

MIT
