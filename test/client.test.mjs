import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const patchSource = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    snapshot(key) {
      return values.get(key)
    },
  }
}

function loadBundle(storage = createStorage()) {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let exported
  const context = {
    window: {
      localStorage: storage,
      __ModuleLoader__: {
        load(definition) {
          assert.equal(definition.id, 'dsh-input-history')
          exported = definition.factory()
        },
      },
    },
    document: {
      addEventListener() {},
      removeEventListener() {},
    },
    HTMLTextAreaElement: class HTMLTextAreaElement {},
    Element: class Element {},
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type
        this.bubbles = Boolean(options.bubbles)
      }
    },
    JSON,
    Object,
    WeakMap,
  }
  vm.runInNewContext(source, context, { filename: 'lib/client.js' })
  return { exports: exported, context, storage }
}

test('bundle patch uses the loader patch-list format', () => {
  assert.match(patchSource, /^- insert:\r?\n/)
  assert.match(patchSource, /^    - id: input-history$/m)
  assert.match(patchSource, /^      name: dsh-input-history$/m)
  assert.doesNotMatch(patchSource, /^plugins:/m)
})

test('client bundle registers the expected plugin contract', () => {
  const { exports } = loadBundle()
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(Array.from(exports.inject), [])
  assert.equal(exports.STORAGE_KEY, 'dsh-input-history:v1')
  assert.equal(exports.MAX_ENTRIES, 200)
})

test('empty or malformed storage is read safely', () => {
  const empty = loadBundle()
  assert.deepEqual(Array.from(empty.exports.readHistory()), [])

  const malformedStorage = createStorage({ 'dsh-input-history:v1': '{broken json' })
  const malformed = loadBundle(malformedStorage)
  assert.deepEqual(Array.from(malformed.exports.readHistory()), [])
})

test('history ignores blank values and moves duplicates to the newest position', () => {
  const { exports, storage } = loadBundle()
  exports.addHistoryEntry(' first ')
  exports.addHistoryEntry('second')
  exports.addHistoryEntry('first')
  exports.addHistoryEntry('   ')

  assert.deepEqual(Array.from(exports.readHistory()), ['second', 'first'])
  assert.equal(storage.snapshot(exports.STORAGE_KEY), JSON.stringify(['second', 'first']))
})

test('history is limited to the newest 200 entries', () => {
  const { exports } = loadBundle()
  for (let index = 0; index < 205; index += 1) {
    exports.addHistoryEntry(`entry-${index}`)
  }

  const history = Array.from(exports.readHistory())
  assert.equal(history.length, 200)
  assert.equal(history[0], 'entry-5')
  assert.equal(history.at(-1), 'entry-204')
})

test('apply installs and removes all captured document listeners', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let exported
  const installed = []
  const removed = []
  const context = {
    window: {
      localStorage: createStorage(),
      __ModuleLoader__: {
        load(definition) {
          exported = definition.factory()
        },
      },
    },
    document: {
      addEventListener(type, listener, capture) {
        installed.push({ type, listener, capture })
      },
      removeEventListener(type, listener, capture) {
        removed.push({ type, listener, capture })
      },
    },
    HTMLTextAreaElement: class HTMLTextAreaElement {},
    Element: class Element {},
    Event: class Event {},
    JSON,
    Object,
    WeakMap,
  }
  vm.runInNewContext(source, context, { filename: 'lib/client.js' })

  let cleanup
  exported.apply({
    effect(factory, label) {
      assert.equal(label, 'dsh-input-history: keyboard history')
      cleanup = factory()
    },
  })

  assert.deepEqual(installed.map(({ type, capture }) => [type, capture]), [
    ['keydown', true],
    ['keyup', true],
    ['submit', true],
  ])

  cleanup()
  assert.equal(removed.length, installed.length)
  for (let index = 0; index < installed.length; index += 1) {
    assert.equal(removed[index].type, installed[index].type)
    assert.equal(removed[index].listener, installed[index].listener)
    assert.equal(removed[index].capture, true)
  }
})
