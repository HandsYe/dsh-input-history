/**
 * Behavioural tests for the browser half, run with `node --test`.
 *
 * The bundle is a classic script in the loader's lazy-CJS factory format, so it
 * is executed against a stub loader. Three layers are covered:
 *
 * 1. The history store and `planNavigation`, the pure walk decision.
 * 2. The caret probes, through a small range double that models a flat text
 *    container — which is what the probes reduce to. That is a stub, not a DOM:
 *    it proves the probe arithmetic, not browser range behaviour.
 * 3. The end-to-end key path: bridge mount -> root listener -> keydown ->
 *    `setDraft`. This is the path that decides whether the plugin works at all,
 *    so it is driven through the real listener the bundle installs on `document`
 *    rather than by calling internals.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const patchSource = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    snapshot: (key) => values.get(key),
  }
}

/** A flat-text container double standing in for the composer element. */
function fakeRoot(text) {
  return {
    textContent: text,
    innerText: text,
    contains(node) {
      return node === this
    },
  }
}

/**
 * A range double over a flat container. A real `Range` exposes its boundaries
 * directly as well as through `cloneRange`, so this double does too.
 */
function makeRange(startContainer, startOffset, endContainer, endOffset) {
  return {
    startContainer,
    startOffset,
    endContainer,
    endOffset,
    cloneRange() {
      return makeRange(this.startContainer, this.startOffset, this.endContainer, this.endOffset)
    },
    selectNodeContents(node) {
      this.startContainer = node
      this.startOffset = 0
      this.endContainer = node
      this.endOffset = node.textContent.length
    },
    setEnd(node, at) {
      this.endContainer = node
      this.endOffset = at
    },
    setStart(node, at) {
      this.startContainer = node
      this.startOffset = at
    },
    toString() {
      if (this.startContainer !== this.endContainer) return ''
      const text = this.startContainer.textContent ?? ''
      return text.slice(this.startOffset, this.endOffset)
    },
  }
}

/** A collapsed selection double at one offset; the caret can be moved between presses. */
function fakeSelection(root, offset) {
  const state = { offset }
  return {
    rangeCount: 1,
    isCollapsed: true,
    getRangeAt: () => makeRange(root, state.offset, root, state.offset),
    moveTo(next) {
      state.offset = next
    },
  }
}

/** An open (non-collapsed) selection double. */
function fakeOpenSelection(root, offset) {
  const state = { offset }
  return {
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => makeRange(root, state.offset, root, state.offset),
    moveTo(next) {
      state.offset = next
    },
  }
}

/**
 * Execute the bundle the way the client module loader does.
 * @param {object} options - stub collaborators.
 * @returns {object} the exports plus what the bundle touched.
 */
function loadBundle({ storage = createStorage(), selection = null } = {}) {
  let exported
  const listeners = []
  const context = {
    window: { localStorage: storage },
    document: {
      addEventListener: (type, listener, capture) => listeners.push({ type, listener, capture }),
      removeEventListener: () => undefined,
    },
    getSelection: () => selection,
    MutationObserver: undefined,
    JSON,
    Object,
    WeakMap,
    console,
  }
  context.window.__ModuleLoader__ = {
    load(definition) {
      assert.equal(definition.id, 'dsh-input-history')
      exported = definition.factory((specifier) => {
        assert.equal(specifier, 'react')
        return {
          // The double runs the effect body so a mounted bridge really binds.
          useEffect: (body) => {
            body()
          },
        }
      })
    },
  }
  vm.runInNewContext(source, context, { filename: 'lib/client.js' })
  return { exports: exported, listeners, storage }
}

/** A walk cursor parked at the live draft. */
function liveCursor(history, draft = '') {
  return { index: history.length, draft }
}

/** The text one navigation step installs, or null when the key passes through. */
function installed(step) {
  return step === null ? null : step.text
}

/** A keydown double. */
function keyEvent(key, target, overrides = {}) {
  const event = {
    key,
    target,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
    defaultPrevented: false,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    ...overrides,
  }
  return event
}

//#region contract
test('bundle patch uses the loader patch-list format', () => {
  assert.match(patchSource, /^- insert:\r?\n/)
  assert.match(patchSource, /^    - id: input-history$/m)
  assert.match(patchSource, /^      name: dsh-input-history$/m)
  assert.doesNotMatch(patchSource, /^plugins:/m)
})

test('the bundle declares the services its composer access needs', () => {
  const { exports } = loadBundle()
  assert.equal(typeof exports.apply, 'function')
  const inject = Array.from(exports.inject)
  assert.ok(inject.includes('slots'), 'needs the slot registry')
  assert.ok(inject.includes('sessions'), 'needs to resolve a session scope')
  assert.ok(inject.includes('conversation'), 'needs the conversation service')
  assert.equal(exports.STORAGE_KEY, 'dsh-input-history:v1')
  assert.equal(exports.MAX_ENTRIES, 200)
})

test('the bridge mounts into list-scoped composer slots', () => {
  const { exports } = loadBundle()
  assert.deepEqual(Array.from(exports.BRIDGE_SLOTS), [
    'conversation.input.left',
    'conversation.input.right',
  ])
})

test('apply installs one capture-phase keydown listener and both bridges', () => {
  const { exports, listeners } = loadBundle()
  const injected = []
  const registered = []
  let cleanup
  exports.apply({
    effect(factory) {
      cleanup = factory()
    },
    slots: {
      inject(name, build) {
        injected.push(name)
        build()
      },
      register(entry) {
        registered.push(entry)
      },
    },
  })

  assert.deepEqual(injected, Array.from(exports.BRIDGE_SLOTS))
  assert.deepEqual(registered.map((entry) => entry.name), Array.from(exports.BRIDGE_SLOTS))
  for (const entry of registered) {
    assert.equal(entry.id, 'input-history')
    assert.equal(typeof entry.inject, 'function')
  }
  assert.deepEqual(listeners.map(({ type, capture }) => [type, capture]), [['keydown', true]])
  assert.equal(typeof cleanup, 'function')
})

test('the bridge resolves a session input shell through the slot injection', () => {
  const { exports } = loadBundle()
  const shell = { snapshot: { draft: '' }, arbitrate: () => 'pass', setDraft: () => undefined }
  // Mimics the real service shape: sessions.scope(id) -> actx, and the
  // conversation service reached from that scope yields the input hub.
  const actx = {
    get: (name) =>
      name === 'conversation'
        ? { input: { for: (scope) => (scope === actx ? shell : undefined) } }
        : undefined,
  }
  const registered = []
  exports.apply({
    effect: (factory) => factory(),
    sessions: { scope: (id) => (id === 'session-1' ? actx : undefined) },
    slots: {
      inject: (_name, build) => build(),
      register: (entry) => registered.push(entry),
    },
  })

  assert.equal(registered[0].inject('session-1').shell, shell)
  assert.equal(registered[0].inject('unknown-session').shell, undefined, 'an unknown session yields no shell')
  assert.equal(registered[0].inject(undefined).shell, undefined, 'a missing session id is handled')
})
//#endregion

//#region history store
test('empty or malformed storage is read safely', () => {
  assert.deepEqual(Array.from(loadBundle().exports.readHistory()), [])
  const broken = loadBundle({ storage: createStorage({ 'dsh-input-history:v1': '{broken' }) })
  assert.deepEqual(Array.from(broken.exports.readHistory()), [])
  const notAList = loadBundle({ storage: createStorage({ 'dsh-input-history:v1': '{"a":1}' }) })
  assert.deepEqual(Array.from(notAList.exports.readHistory()), [])
})

test('remember trims, drops blanks, and moves a repeat to the newest position', () => {
  const { exports, storage } = loadBundle()
  exports.remember(' first ')
  exports.remember('second')
  exports.remember('first')
  exports.remember('   ')
  exports.remember(undefined)

  assert.deepEqual(Array.from(exports.readHistory()), ['second', 'first'])
  assert.equal(storage.snapshot(exports.STORAGE_KEY), JSON.stringify(['second', 'first']))
})

test('history is capped at the newest 200 entries', () => {
  const { exports } = loadBundle()
  for (let index = 0; index < 205; index += 1) exports.remember(`entry-${index}`)

  const history = Array.from(exports.readHistory())
  assert.equal(history.length, 200)
  assert.equal(history[0], 'entry-5')
  assert.equal(history.at(-1), 'entry-204')
})

test('textOf strips contenteditable artefacts and survives a null root', () => {
  const { exports } = loadBundle()
  assert.equal(exports.textOf(null), '')
  assert.equal(exports.textOf({ textContent: 'plain' }), 'plain')
  assert.equal(exports.textOf({ innerText: 'line\u200b one' }), 'line one')
})
//#endregion

//#region navigation decisions
test('an empty history passes every arrow through', () => {
  const { exports } = loadBundle()
  const cursor = liveCursor([])
  assert.equal(exports.planNavigation('ArrowUp', [], cursor, '', true, false), null)
  assert.equal(exports.planNavigation('ArrowDown', [], cursor, '', false, true), null)
})

test('Arrow Up walks back through history and Arrow Down returns to the live draft', () => {
  const { exports } = loadBundle()
  const history = ['oldest', 'newer']
  const cursor = liveCursor(history)

  // Leaving a live draft whose caret sits at the start captures the draft.
  assert.equal(installed(exports.planNavigation('ArrowUp', history, cursor, 'my draft', true, false)), 'newer')
  assert.equal(cursor.draft, 'my draft', 'the live draft is captured on the way up')

  // From here the shell has put the caret at the END of the recalled text. The
  // walk must continue anyway, or every second press would be a no-op.
  assert.equal(installed(exports.planNavigation('ArrowUp', history, cursor, 'newer', false, true)), 'oldest')
  assert.equal(exports.planNavigation('ArrowUp', history, cursor, 'oldest', false, true), null, 'the oldest entry ends the walk')

  assert.equal(installed(exports.planNavigation('ArrowDown', history, cursor, 'oldest', false, true)), 'newer')
  assert.equal(
    installed(exports.planNavigation('ArrowDown', history, cursor, 'newer', false, true)),
    'my draft',
    'the untouched draft is restored at the end',
  )
  assert.equal(exports.planNavigation('ArrowDown', history, cursor, 'my draft', false, true), null)
})

test('editing a recalled entry ends the walk', () => {
  const { exports } = loadBundle()
  const history = ['oldest', 'newer']
  const cursor = { index: 1, draft: 'my draft' }

  // The text no longer matches the installed entry and the caret is mid-text,
  // so the arrow belongs to the editor again.
  assert.equal(exports.planNavigation('ArrowUp', history, cursor, 'newer!', false, false), null)
  assert.equal(cursor.index, 1, 'the cursor stays where it was')
})

test('a caret away from the boundary leaves the arrow to the editor', () => {
  const { exports } = loadBundle()
  const history = ['a']
  const cursor = liveCursor(history)

  assert.equal(exports.planNavigation('ArrowUp', history, cursor, 'draft', false, false), null)
  assert.equal(cursor.index, history.length, 'a passed-through key never moves the cursor')
  assert.equal(exports.planNavigation('ArrowDown', history, cursor, 'draft', false, false), null)
  assert.equal(cursor.index, history.length)
})

test('Arrow Down does nothing while the live draft is showing', () => {
  const { exports } = loadBundle()
  const history = ['a', 'b']
  assert.equal(exports.planNavigation('ArrowDown', history, liveCursor(history), 'draft', false, true), null)
})

test('a cursor left past the end is clamped when the history shrinks', () => {
  const { exports } = loadBundle()
  const cursor = { index: 9, draft: '' }
  assert.equal(installed(exports.planNavigation('ArrowUp', ['only'], cursor, 'draft', true, false)), 'only')
  assert.equal(cursor.index, 0)
})
//#endregion

//#region caret probes
test('caret probes read a collapsed caret at the container edges', () => {
  const root = fakeRoot('hello')
  const atStart = loadBundle({ selection: fakeSelection(root, 0) }).exports
  assert.equal(atStart.caretAtStart(root), true)
  assert.equal(atStart.caretAtEnd(root), false)

  const inMiddle = loadBundle({ selection: fakeSelection(root, 2) }).exports
  assert.equal(inMiddle.caretAtStart(root), false)
  assert.equal(inMiddle.caretAtEnd(root), false)

  const atEnd = loadBundle({ selection: fakeSelection(root, 5) }).exports
  assert.equal(atEnd.caretAtStart(root), false)
  assert.equal(atEnd.caretAtEnd(root), true)
})

test('an open selection is never a history boundary', () => {
  const root = fakeRoot('hello')
  const { exports } = loadBundle({ selection: fakeOpenSelection(root, 0) })
  assert.equal(exports.caretAtStart(root), false)
  assert.equal(exports.caretAtEnd(root), false)
})

test('a caret in another element is not a boundary for the composer', () => {
  const root = fakeRoot('hello')
  const elsewhere = fakeRoot('other')
  const { exports } = loadBundle({ selection: fakeSelection(elsewhere, 0) })
  assert.equal(exports.caretAtStart(root), false)
  assert.equal(exports.caretAtEnd(root), false)
})

test('no selection at all is handled without throwing', () => {
  const root = fakeRoot('hello')
  const { exports } = loadBundle({ selection: null })
  assert.equal(exports.caretAtStart(root), false)
  assert.equal(exports.caretAtEnd(root), false)
})
//#endregion

//#region end-to-end key path
/**
 * Mount the bridge the way the shell does and return the driving handles.
 * @param {object} options - storage, caret offset, arbitration verdict, draft.
 * @returns {object} the composer double and the key driver.
 */
function mountComposer({ storage = createStorage(), caret = 0, verdict = 'pass', draft = 'my draft' } = {}) {
  const root = fakeRoot(draft)
  const selection = fakeSelection(root, caret)
  let rootListener
  const writes = []
  const shell = {
    editor: {
      registerRootListener(fn) {
        rootListener = fn
        return () => {
          rootListener = undefined
        }
      },
    },
    snapshot: { draft },
    arbitrate: () => verdict,
    // Mirrors the real shell: the whole draft is replaced and the caret lands at
    // the end, which is exactly why an unmodified second press must still walk.
    setDraft(text) {
      writes.push(text)
      root.textContent = text
      root.innerText = text
      shell.snapshot.draft = text
      selection.moveTo(text.length)
    },
  }

  const bundle = loadBundle({ storage, selection })
  bundle.exports.apply({
    effect: (factory) => factory(),
    slots: {
      inject: (_name, build) => build(),
      register: () => undefined,
    },
  })
  bundle.exports.HistoryBridge({ shell })
  if (typeof rootListener === 'function') rootListener(root)

  const keydown = bundle.listeners.find(({ type }) => type === 'keydown')
  return {
    root,
    shell,
    writes,
    caretTo: (offset) => selection.moveTo(offset),
    mountBridgeAgain: () => bundle.exports.HistoryBridge({ shell }),
    fire: (event) => keydown.listener(event),
  }
}

/** Seed a storage with sent prompts, the way a previous send would. */
function seed(storage, prompts) {
  const { exports } = loadBundle({ storage })
  for (const prompt of prompts) exports.remember(prompt)
}

test('Arrow Up at the composer start recalls the newest prompt', () => {
  const storage = createStorage()
  seed(storage, ['older prompt', 'newest prompt'])
  const { fire, root, writes } = mountComposer({ storage, caret: 0 })

  const event = keyEvent('ArrowUp', root)
  fire(event)

  assert.deepEqual(writes, ['newest prompt'], 'the draft is replaced through setDraft')
  assert.equal(event.prevented, true, 'the browser must not also move the caret')
  assert.equal(event.stopped, true, 'the editor keymap must not also see the press')
})

test('Arrow Up twice walks one entry further back', () => {
  const storage = createStorage()
  seed(storage, ['older prompt', 'newest prompt'])
  const { fire, root, writes } = mountComposer({ storage, caret: 0 })

  fire(keyEvent('ArrowUp', root))
  fire(keyEvent('ArrowUp', root))

  assert.deepEqual(writes, ['newest prompt', 'older prompt'])
})

test('the live draft is restored after walking back', () => {
  const storage = createStorage()
  seed(storage, ['sent'])
  const { fire, root, writes } = mountComposer({ storage, caret: 0, draft: 'unsent draft' })

  fire(keyEvent('ArrowUp', root))
  fire(keyEvent('ArrowDown', root))

  assert.deepEqual(writes, ['sent', 'unsent draft'])
})

test('a caret inside the text leaves the arrow to the editor', () => {
  const storage = createStorage()
  seed(storage, ['sent'])
  const { fire, root, writes } = mountComposer({ storage, caret: 3, draft: 'my draft' })

  const event = keyEvent('ArrowUp', root)
  fire(event)

  assert.deepEqual(writes, [], 'no history write while the caret is mid-text')
  assert.equal(event.prevented, false)
  assert.equal(event.stopped, false)
})

test('an open trigger menu keeps its own arrows', () => {
  const storage = createStorage()
  seed(storage, ['sent'])
  const { fire, root, writes } = mountComposer({ storage, caret: 0, verdict: 'consumed' })

  const event = keyEvent('ArrowUp', root)
  fire(event)

  assert.deepEqual(writes, [], 'the menu owns the key while it is open')
  assert.equal(event.prevented, false)
  assert.equal(event.stopped, false)
})

test('modified arrows and composition keys are never intercepted', () => {
  const storage = createStorage()
  seed(storage, ['sent'])
  const { fire, root, writes } = mountComposer({ storage, caret: 0 })

  fire(keyEvent('ArrowUp', root, { shiftKey: true }))
  fire(keyEvent('ArrowUp', root, { ctrlKey: true }))
  fire(keyEvent('ArrowUp', root, { isComposing: true }))
  fire(keyEvent('ArrowUp', root, { keyCode: 229 }))

  assert.deepEqual(writes, [])
})

test('an unrelated key passes through untouched', () => {
  const storage = createStorage()
  seed(storage, ['sent'])
  const { fire, root, writes } = mountComposer({ storage, caret: 0 })

  const event = keyEvent('a', root)
  fire(event)

  assert.deepEqual(writes, [])
  assert.equal(event.prevented, false)
})

test('a keydown outside the composer is ignored', () => {
  const storage = createStorage()
  seed(storage, ['sent'])
  const { fire, writes } = mountComposer({ storage, caret: 0 })

  const event = keyEvent('ArrowUp', fakeRoot('somewhere else'))
  fire(event)

  assert.deepEqual(writes, [])
  assert.equal(event.prevented, false)
})

test('binding twice through both slots still handles one press once', () => {
  const storage = createStorage()
  seed(storage, ['sent'])
  const { fire, root, writes, mountBridgeAgain } = mountComposer({ storage, caret: 0 })

  mountBridgeAgain()
  fire(keyEvent('ArrowUp', root))

  assert.deepEqual(writes, ['sent'], 'a double mount must not double-handle the key')
})

test('an already-cancelled event is left alone', () => {
  const storage = createStorage()
  seed(storage, ['sent'])
  const { fire, root, writes } = mountComposer({ storage, caret: 0 })

  fire(keyEvent('ArrowUp', root, { defaultPrevented: true }))

  assert.deepEqual(writes, [])
})
//#endregion
