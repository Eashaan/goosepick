import "@testing-library/jest-dom";

// Browser shims only apply under jsdom; pure-logic suites may opt into the
// node environment (e.g. the Shopify webhook core) and have no `window`.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
