window.__ModuleLoader__.load({
  id: "dsh-input-history",
  factory: () => {
    var module = { exports: {} };
    var exports = module.exports;

    const STORAGE_KEY = "dsh-input-history:v1";
    const MAX_ENTRIES = 200;
    const states = new WeakMap();

    function isComposer(element) {
      if (!(element instanceof HTMLTextAreaElement)) return false;
      if (element.disabled || element.readOnly) return false;
      return Boolean(element.closest("form") || element.getAttribute("aria-label") || element.placeholder);
    }

    function readHistory(storage = window.localStorage) {
      try {
        const value = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(value)
          ? value.filter((item) => typeof item === "string" && item.trim() !== "").slice(-MAX_ENTRIES)
          : [];
      } catch {
        return [];
      }
    }

    function saveHistory(history, storage = window.localStorage) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_ENTRIES)));
      } catch {
        // Storage may be unavailable in private or restricted browser contexts.
      }
    }

    function addHistoryEntry(text, storage = window.localStorage) {
      const normalized = text.trim();
      if (!normalized) return readHistory(storage);
      const history = readHistory(storage).filter((entry) => entry !== normalized);
      history.push(normalized);
      saveHistory(history, storage);
      return history;
    }

    function replaceValue(textarea, value) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(textarea, value);
      else textarea.value = value;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.setSelectionRange(value.length, value.length);
    }

    function stateFor(textarea) {
      let state = states.get(textarea);
      if (!state) {
        state = { index: readHistory().length, draft: textarea.value };
        states.set(textarea, state);
      }
      return state;
    }

    function resetNavigation(textarea) {
      states.set(textarea, { index: readHistory().length, draft: textarea.value });
    }

    function atFirstLine(textarea) {
      return textarea.selectionStart === textarea.selectionEnd &&
        !textarea.value.slice(0, textarea.selectionStart).includes("\n");
    }

    function atLastLine(textarea) {
      return textarea.selectionStart === textarea.selectionEnd &&
        !textarea.value.slice(textarea.selectionEnd).includes("\n");
    }

    function onKeyDown(event) {
      const textarea = event.target;
      if (!isComposer(textarea) || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (event.key === "ArrowUp" && !atFirstLine(textarea)) return;
      if (event.key === "ArrowDown" && !atLastLine(textarea)) return;

      const history = readHistory();
      if (!history.length) return;
      const state = stateFor(textarea);

      if (event.key === "ArrowUp") {
        if (state.index === history.length) state.draft = textarea.value;
        if (state.index <= 0) return;
        state.index -= 1;
        event.preventDefault();
        replaceValue(textarea, history[state.index]);
        return;
      }

      if (state.index >= history.length) return;
      state.index += 1;
      event.preventDefault();
      replaceValue(textarea, state.index === history.length ? state.draft : history[state.index]);
    }

    function onSubmit(event) {
      const textarea = event.target instanceof Element ? event.target.querySelector("textarea") : null;
      if (!isComposer(textarea)) return;
      addHistoryEntry(textarea.value);
      resetNavigation(textarea);
    }

    function onKeyUp(event) {
      const textarea = event.target;
      if (!isComposer(textarea) || event.isComposing) return;
      if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        addHistoryEntry(textarea.value);
        resetNavigation(textarea);
      }
    }

    function apply(ctx) {
      ctx.effect(() => {
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("keyup", onKeyUp, true);
        document.addEventListener("submit", onSubmit, true);
        return () => {
          document.removeEventListener("keydown", onKeyDown, true);
          document.removeEventListener("keyup", onKeyUp, true);
          document.removeEventListener("submit", onSubmit, true);
        };
      }, "dsh-input-history: keyboard history");
    }

    exports.STORAGE_KEY = STORAGE_KEY;
    exports.MAX_ENTRIES = MAX_ENTRIES;
    exports.readHistory = readHistory;
    exports.saveHistory = saveHistory;
    exports.addHistoryEntry = addHistoryEntry;
    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  }
});
