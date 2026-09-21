window.__ModuleLoader__.load({
	id: "dsh-input-history",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region history store
		/**
		 * Prompt-history storage.
		 *
		 * The composer of this shell is a Lexical `contenteditable`, not a
		 * `<textarea>`, so nothing here may assume a textarea exists. The store is
		 * a plain ordered list of sent prompts in `localStorage`: the newest entry
		 * is the last element, blanks are never stored, and a repeat of an existing
		 * entry moves to the newest position rather than duplicating.
		 */

		/** Storage key holding the ordered history. */
		const STORAGE_KEY = "dsh-input-history:v1";
		/** Upper bound on retained entries; the oldest are dropped first. */
		const MAX_ENTRIES = 200;
		/** Artefacts a contenteditable can leave in its visible text. */
		const INVISIBLE = /[\u200b\ufeff\u200e\u200f]/g;

		/**
		 * The storage this shell writes history into.
		 *
		 * `window.localStorage` is preferred because a sandboxed frame can expose a
		 * working `window` while its `globalThis` proxy hides the property; reading
		 * either can also throw outright, which is why both are guarded.
		 * @returns {Storage | undefined} the storage, when one is reachable.
		 */
		function defaultStorage() {
			const scopes = [typeof window === "undefined" ? undefined : window, globalThis];
			for (const scope of scopes) {
				if (scope === undefined || scope === null) continue;
				try {
					const candidate = scope.localStorage;
					if (candidate !== undefined && candidate !== null) return candidate;
				} catch {
					// Access denied; try the next scope.
				}
			}
			return undefined;
		}

		/**
		 * Read the stored history, dropping anything malformed.
		 * @param {Storage} [storage] - storage to read; defaults to localStorage.
		 * @returns {string[]} the entries, oldest first.
		 */
		function readHistory(storage) {
			const store = storage ?? defaultStorage();
			if (store === undefined || store === null) return [];
			try {
				const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? "[]");
				if (!Array.isArray(parsed)) return [];
				return parsed
					.filter((entry) => typeof entry === "string" && entry.trim() !== "")
					.slice(-MAX_ENTRIES);
			} catch {
				return [];
			}
		}

		/**
		 * Write the history back, trimmed to the retention bound.
		 * @param {string[]} history - the entries, oldest first.
		 * @param {Storage} [storage] - storage to write; defaults to localStorage.
		 */
		function writeHistory(history, storage) {
			const store = storage ?? defaultStorage();
			if (store === undefined || store === null) return;
			try {
				store.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_ENTRIES)));
			} catch {
				// A full or blocked storage must never break typing.
			}
		}

		/**
		 * Remember one sent prompt: trimmed, de-duplicated, newest last.
		 * @param {string} text - the prompt that was just sent.
		 * @param {Storage} [storage] - storage to write; defaults to localStorage.
		 * @returns {string[]} the resulting history.
		 */
		function remember(text, storage) {
			const value = typeof text === "string" ? text.replace(INVISIBLE, "").trim() : "";
			if (value === "") return readHistory(storage);
			const history = readHistory(storage).filter((entry) => entry !== value);
			history.push(value);
			writeHistory(history, storage);
			return history;
		}

		/**
		 * The visible text of a composer root, with contenteditable artefacts removed.
		 * @param {HTMLElement} root - the composer's contenteditable element.
		 * @returns {string} the text a user would say they typed.
		 */
		function textOf(root) {
			if (root === undefined || root === null) return "";
			const raw = typeof root.innerText === "string" ? root.innerText : root.textContent;
			return typeof raw === "string" ? raw.replace(INVISIBLE, "") : "";
		}
		//#endregion

		//#region navigation
		/**
		 * History navigation over one composer.
		 *
		 * A cursor walks the stored list; `index === history.length` means "the
		 * live draft", captured on the way up so walking back down can restore it.
		 * The decision is a pure function of the key, the list, the cursor and two
		 * caret-boundary probes, so it is exercised by tests without a browser.
		 */

		/**
		 * Decide the next history position for one arrow press.
		 * @param {string} key - "ArrowUp" or "ArrowDown".
		 * @param {string[]} history - stored entries, oldest first.
		 * @param {{index: number, draft: string}} cursor - the walk position (mutated).
		 * @param {string} currentText - the draft currently in the composer.
		 * @param {boolean} atStart - the caret sits before all text.
		 * @param {boolean} atEnd - the caret sits after all text.
		 * @returns {{text: string} | null} text to install, or null to pass the key through.
		 */
		function planNavigation(key, history, cursor, currentText, atStart, atEnd) {
			if (history.length === 0) return null;
			if (cursor.index > history.length) cursor.index = history.length;

			// While the composer still shows the entry this cursor installed, the walk
			// continues wherever the caret sits: the shell places the caret at the end
			// of a recalled draft, so demanding the start again would turn every
			// second press into a no-op. Any other text means the user edited, which
			// ends the walk and hands the arrows back to the editor.
			const walking = cursor.index < history.length && currentText === history[cursor.index];

			if (key === "ArrowUp") {
				// Leaving the live draft captures it, so the way back down restores it.
				if (cursor.index === history.length) cursor.draft = currentText;
				if (!walking && !atStart) return null;
				if (cursor.index <= 0) return null;
				cursor.index -= 1;
				return { text: history[cursor.index] };
			}

			if (key === "ArrowDown") {
				if (!walking && !atEnd) return null;
				if (cursor.index >= history.length) return null;
				cursor.index += 1;
				return { text: cursor.index === history.length ? cursor.draft : history[cursor.index] };
			}

			return null;
		}

		/**
		 * The document selection when it is a collapsed caret inside the composer.
		 *
		 * An open selection is never a boundary: replacing a highlighted span with a
		 * history entry would discard text the user deliberately selected.
		 * @param {HTMLElement} root - the composer's contenteditable element.
		 * @returns {Range | null} the caret range, or null when there is none.
		 */
		function collapsedCaretRange(root) {
			if (root === undefined || root === null) return null;
			const selection = typeof globalThis.getSelection === "function" ? globalThis.getSelection() : null;
			if (selection === null || selection === undefined) return null;
			if (selection.rangeCount === 0 || selection.isCollapsed !== true) return null;
			const range = selection.getRangeAt(0);
			if (typeof root.contains === "function" && !root.contains(range.startContainer)) return null;
			return range;
		}

		/**
		 * Measure the text between the composer's start and the caret.
		 * @param {HTMLElement} root - the composer's contenteditable element.
		 * @returns {boolean} true only for a collapsed caret with no text before it.
		 */
		function caretAtStart(root) {
			const range = collapsedCaretRange(root);
			if (range === null) return false;
			try {
				const before = range.cloneRange();
				before.selectNodeContents(root);
				before.setEnd(range.startContainer, range.startOffset);
				return before.toString() === "";
			} catch {
				return false;
			}
		}

		/**
		 * Measure the text between the caret and the composer's end.
		 * @param {HTMLElement} root - the composer's contenteditable element.
		 * @returns {boolean} true only for a collapsed caret with no text after it.
		 */
		function caretAtEnd(root) {
			const range = collapsedCaretRange(root);
			if (range === null) return false;
			try {
				const after = range.cloneRange();
				after.selectNodeContents(root);
				after.setStart(range.endContainer, range.endOffset);
				return after.toString() === "";
			} catch {
				return false;
			}
		}
		//#endregion

		//#region session bindings
		/**
		 * Per-composer bindings.
		 *
		 * The composer's text and caret belong to a shell-owned Lexical editor, so
		 * this bundle never writes the DOM itself: it reads the draft through the
		 * shell's snapshot and writes it back through `setDraft`, the documented
		 * programmatic write (placeholder-sanitized, newlines split into paragraphs,
		 * caret placed at the end, merged into undo history). The editor's root
		 * element is tracked through `registerRootListener`, which is also how the
		 * shell's own keymap follows a remount.
		 *
		 * Bindings are reference-counted because the bridge mounts into two composer
		 * slots; both hosts resolve the same shell, and only one binding may exist
		 * per shell or every arrow press would be handled twice.
		 */

		/** Live binding per shell: `{refs, root, stopRoot, observer, last}`. */
		const bindings = new Map();
		/** Walk cursor per shell, held weakly so a closed session leaves nothing behind. */
		const cursors = new WeakMap();

		/**
		 * The walk cursor for one shell, created at the live-draft end of the list.
		 * @param {object} shell - the session's input shell.
		 * @returns {{index: number, draft: string}} the cursor.
		 */
		function cursorOf(shell) {
			let cursor = cursors.get(shell);
			if (cursor === undefined) {
				cursor = { index: readHistory().length, draft: "" };
				cursors.set(shell, cursor);
			}
			return cursor;
		}

		/**
		 * The draft currently in one composer.
		 * @param {object} shell - the session's input shell.
		 * @param {HTMLElement} root - the composer's contenteditable element.
		 * @returns {string} the draft text.
		 */
		function currentDraft(shell, root) {
			try {
				const snapshot = shell.snapshot;
				if (snapshot !== undefined && snapshot !== null && typeof snapshot.draft === "string") {
					return snapshot.draft;
				}
			} catch {
				// A shell mid-teardown has no snapshot; the DOM still does.
			}
			return textOf(root);
		}

		/**
		 * Watch one composer root so a send is remembered. A send empties the
		 * composer, which is the one signal every send path shares — the button, the
		 * Enter key and queued steering all clear the draft through the same shell.
		 * @param {object} record - the binding record to update.
		 * @param {HTMLElement} root - the composer's contenteditable element.
		 */
		function watchRoot(record, root) {
			if (record.observer !== null) {
				record.observer.disconnect();
				record.observer = null;
			}
			record.root = root ?? null;
			record.last = textOf(record.root);
			if (record.root === null || typeof MutationObserver !== "function") return;
			record.observer = new MutationObserver(() => {
				const text = textOf(record.root);
				if (text === "" && record.last.trim() !== "") remember(record.last);
				record.last = text;
			});
			record.observer.observe(record.root, { childList: true, subtree: true, characterData: true });
		}

		/**
		 * Bind one shell, or take another reference to an existing binding.
		 * @param {object} shell - the session's input shell.
		 * @returns {() => void} the release disposer for this reference.
		 */
		function bindShell(shell) {
			let record = bindings.get(shell);
			if (record === undefined) {
				record = { refs: 0, root: null, stopRoot: null, observer: null, last: "" };
				bindings.set(shell, record);
				const editor = shell === undefined || shell === null ? undefined : shell.editor;
				if (editor !== undefined && editor !== null && typeof editor.registerRootListener === "function") {
					record.stopRoot = editor.registerRootListener((root) => {
						watchRoot(record, root);
					});
				}
			}
			record.refs += 1;

			let released = false;
			return () => {
				if (released) return;
				released = true;
				record.refs -= 1;
				if (record.refs > 0) return;
				if (typeof record.stopRoot === "function") record.stopRoot();
				if (record.observer !== null) record.observer.disconnect();
				bindings.delete(shell);
				cursors.delete(shell);
			};
		}

		/**
		 * Whether a keydown belongs to one bound composer.
		 * @param {object} record - the binding record.
		 * @param {EventTarget | null} target - the event target.
		 * @returns {boolean} whether the event happened inside this composer.
		 */
		function ownsTarget(record, target) {
			const root = record.root;
			if (root === null || target === null || target === undefined) return false;
			return target === root || (typeof root.contains === "function" && root.contains(target));
		}

		/**
		 * Handle one arrow press over the bound composers.
		 *
		 * The listener is installed on `document` in the capture phase so it runs
		 * before the editor's own keymap; a consumed press stops propagation, which
		 * is what keeps the caret from moving as well. An open trigger menu keeps its
		 * arrows: the shell's own arbitration is asked first, and anything other than
		 * "pass" leaves the event strictly alone.
		 * @param {KeyboardEvent} event - the document keydown.
		 */
		function onKeyDown(event) {
			if (event.defaultPrevented) return;
			if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
			if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
			if (event.isComposing === true || event.keyCode === 229) return;

			for (const [shell, record] of bindings) {
				if (!ownsTarget(record, event.target)) continue;
				const root = record.root;

				let verdict = "pass";
				try {
					verdict = shell.arbitrate(event.key === "ArrowUp" ? "up" : "down", false) ?? "pass";
				} catch {
					verdict = "pass";
				}
				if (verdict !== "pass") return;

				const step = planNavigation(
					event.key,
					readHistory(),
					cursorOf(shell),
					currentDraft(shell, root),
					caretAtStart(root),
					caretAtEnd(root),
				);
				if (step === null) return;

				event.preventDefault();
				event.stopPropagation();
				try {
					shell.setDraft(step.text);
				} catch {
					// The session closed mid-press; the draft simply stays as it was.
				}
				return;
			}
		}
		//#endregion

		//#region bridge
		/**
		 * The invisible composer bridge.
		 *
		 * It renders nothing: its only job is to hold one session's input shell long
		 * enough to bind history navigation to it, and to release that binding when
		 * the composer unmounts.
		 * @param {object} props - the resolved session shell.
		 * @returns {null} nothing.
		 */
		function HistoryBridge({ shell }) {
			react.useEffect(() => {
				if (shell === undefined || shell === null) return undefined;
				return bindShell(shell);
			}, [shell]);
			return null;
		}

		/**
		 * Resolve the input shell that owns one session's composer.
		 * @param {object} ctx - the plugin context.
		 * @param {string | undefined} sessionId - the slot's session.
		 * @returns {object | undefined} the shell, when the session is addressable.
		 */
		function resolveShell(ctx, sessionId) {
			if (sessionId === undefined || sessionId === null) return undefined;
			try {
				const actx = ctx.sessions.scope(sessionId);
				if (actx === undefined || actx === null) return undefined;
				const conversation = actx.get("conversation");
				if (conversation === undefined || conversation === null) return undefined;
				const input = conversation.input;
				if (input === undefined || input === null || typeof input.for !== "function") return undefined;
				return input.for(actx) ?? undefined;
			} catch {
				return undefined;
			}
		}
		//#endregion

		//#region plugin
		/**
		 * `list` slots scoped to a session that render together whenever a composer
		 * is live. Binding is reference-counted per shell, so two hosts never
		 * double-handle one key.
		 */
		const BRIDGE_SLOTS = ["conversation.input.left", "conversation.input.right"];
		/** Services this plugin needs from the browser runtime. */
		const inject = ["slots", "sessions", "conversation"];

		/**
		 * Install prompt history: one capture-phase key listener plus the composer
		 * bridges that bind each session's input shell.
		 * @param {object} ctx - the browser plugin context.
		 */
		function apply(ctx) {
			ctx.effect(() => {
				document.addEventListener("keydown", onKeyDown, true);
				return () => {
					document.removeEventListener("keydown", onKeyDown, true);
					for (const record of bindings.values()) {
						if (typeof record.stopRoot === "function") record.stopRoot();
						if (record.observer !== null) record.observer.disconnect();
					}
					bindings.clear();
				};
			}, "dsh-input-history: composer history keys");

			for (const name of BRIDGE_SLOTS) {
				ctx.slots.inject(name, () => {
					ctx.slots.register(
						{
							name,
							id: "input-history",
							order: 100,
							inject: (sessionId) => ({ shell: resolveShell(ctx, sessionId) }),
						},
						HistoryBridge,
					);
				});
			}
		}
		//#endregion

		exports.STORAGE_KEY = STORAGE_KEY;
		exports.MAX_ENTRIES = MAX_ENTRIES;
		exports.BRIDGE_SLOTS = BRIDGE_SLOTS;
		exports.readHistory = readHistory;
		exports.writeHistory = writeHistory;
		exports.remember = remember;
		exports.textOf = textOf;
		exports.planNavigation = planNavigation;
		exports.caretAtStart = caretAtStart;
		exports.caretAtEnd = caretAtEnd;
		exports.HistoryBridge = HistoryBridge;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
