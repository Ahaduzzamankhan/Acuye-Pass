import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
}

// Node 26 can expose `localStorage` as undefined without a backing file, which
// would shadow jsdom's implementation. Provide a deterministic in-memory store.
if (!globalThis.localStorage) {
  const storage = createMemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(""),
    },
  });
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, "crypto", {
      value: {
        ...globalThis.crypto,
        randomUUID: () =>
          `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`,
        getRandomValues: (array: Uint32Array) => {
          for (let i = 0; i < array.length; i += 1) array[i] = Math.floor(Math.random() * 2 ** 32);
          return array;
        },
      },
      configurable: true,
    });
  }
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  if (!("ResizeObserver" in window)) {
    Object.defineProperty(window, "ResizeObserver", { value: ResizeObserverStub });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
