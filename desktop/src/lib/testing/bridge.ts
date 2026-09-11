export type BridgeError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type DesktopBridge = {
  invoke<T>(command: string, input: unknown): Promise<T>;
};

type MockOptions = {
  responses?: Record<string, unknown>;
  failures?: Record<string, BridgeError>;
};

/** A deterministic command seam for tests; production code uses Tauri invoke. */
export function createMockBridge(options: MockOptions = {}): DesktopBridge {
  return {
    async invoke<T>(command: string): Promise<T> {
      const failure = options.failures?.[command];
      if (failure) {
        throw failure;
      }

      if (!(command in (options.responses ?? {}))) {
        throw {
          code: 'test_missing_response',
          message: `No mock response configured for ${command}`,
          retryable: false,
        } satisfies BridgeError;
      }

      return options.responses?.[command] as T;
    },
  };
}
