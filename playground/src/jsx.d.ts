export {}

declare global {
  namespace JSX {
    type Element = unknown

    interface IntrinsicElements {
      [element: string]: Record<string, unknown>
    }
  }
}
