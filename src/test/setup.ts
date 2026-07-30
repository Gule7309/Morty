import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { afterEach } from 'vitest'

Object.defineProperty(globalThis, 'Blob', {
  value: NodeBlob,
  configurable: true,
})

Object.defineProperty(globalThis, 'File', {
  value: NodeFile,
  configurable: true,
})

class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback
  private active = true

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element) {
    const rect = target.getBoundingClientRect()
    queueMicrotask(() => {
      if (!this.active) {
        return
      }
      this.callback(
        [
          {
            target,
            contentRect: rect,
            borderBoxSize: [
              { inlineSize: rect.width, blockSize: rect.height },
            ],
            contentBoxSize: [
              { inlineSize: rect.width, blockSize: rect.height },
            ],
            devicePixelContentBoxSize: [
              { inlineSize: rect.width, blockSize: rect.height },
            ],
          },
        ],
        this,
      )
    })
  }

  unobserve() {}

  disconnect() {
    this.active = false
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: TestResizeObserver,
  configurable: true,
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})
