import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Host-interface double for extension wiring tests.
 *
 * `ExtensionAPI` declares a large required surface. This double implements the
 * whole interface as a real typed object — no cast — while `on` and
 * `appendEntry` carry the test state. Members no test exercises throw if
 * reached, so unexpected host usage fails loudly instead of silently passing.
 */
export interface ExtensionApiDoubleOptions {
  handlers?: Map<string, (...args: unknown[]) => unknown>;
  appendEntry?: (customType: string, data: unknown) => unknown;
}

function notImplemented(member: keyof ExtensionAPI): (...args: any[]) => never {
  return () => {
    throw new Error(`createExtensionApiDouble: ${String(member)} is not implemented`);
  };
}

export function createExtensionApiDouble(options: ExtensionApiDoubleOptions = {}): ExtensionAPI {
  return {
    on(event: string, handler: (...args: any[]) => unknown) {
      options.handlers?.set(event, handler);
    },
    appendEntry(customType: string, data: unknown) {
      options.appendEntry?.(customType, data);
    },
    registerTool: notImplemented("registerTool"),
    registerCommand: notImplemented("registerCommand"),
    registerShortcut: notImplemented("registerShortcut"),
    registerFlag: notImplemented("registerFlag"),
    getFlag: notImplemented("getFlag"),
    registerMessageRenderer: notImplemented("registerMessageRenderer"),
    registerMarkdownTransformer: notImplemented("registerMarkdownTransformer"),
    registerEntryRenderer: notImplemented("registerEntryRenderer"),
    sendMessage: notImplemented("sendMessage"),
    sendUserMessage: notImplemented("sendUserMessage"),
    setSessionName: notImplemented("setSessionName"),
    getSessionName: notImplemented("getSessionName"),
    setLabel: notImplemented("setLabel"),
    exec: notImplemented("exec"),
    getActiveTools: notImplemented("getActiveTools"),
    getAllTools: notImplemented("getAllTools"),
    setActiveTools: notImplemented("setActiveTools"),
    getCommands: notImplemented("getCommands"),
    setModel: notImplemented("setModel"),
    getThinkingLevel: notImplemented("getThinkingLevel"),
    setThinkingLevel: notImplemented("setThinkingLevel"),
    registerProvider: notImplemented("registerProvider"),
    unregisterProvider: notImplemented("unregisterProvider"),
    events: createEventBus(),
  };
}
