import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Host-interface double for extension wiring tests.
 *
 * `ExtensionAPI` declares roughly sixty required members. Tests that use this
 * double mock every sibling module of the factory under test, so only `on`
 * (and optionally `appendEntry`) is ever exercised. The single documented cast
 * below stands in for the rest of the host surface; callback arguments stay
 * typed as `unknown` so each test narrows what it uses.
 */
export interface ExtensionApiDoubleOptions {
  handlers?: Map<string, (...args: unknown[]) => unknown>;
  appendEntry?: (customType: string, data: unknown) => unknown;
}

export function createExtensionApiDouble(options: ExtensionApiDoubleOptions = {}): ExtensionAPI {
  const double: Record<string, unknown> = {
    on: (name: string, handler: (...args: unknown[]) => unknown) => {
      options.handlers?.set(name, handler);
    },
  };
  if (options.appendEntry) double.appendEntry = options.appendEntry;
  return double as unknown as ExtensionAPI;
}
