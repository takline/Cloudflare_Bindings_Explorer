import Module from "node:module";

interface MockR2Config {
  endpointUrl: string;
  region: string;
  forcePathStyle: boolean;
  maxPreviewSizeBytes: number;
}

const defaultR2Config: MockR2Config = {
  endpointUrl: "https://unit-test.r2.example.com",
  region: "auto",
  forcePathStyle: true,
  maxPreviewSizeBytes: 10485760,
};

let r2Config: MockR2Config = { ...defaultR2Config };
type ModuleLoad = (
  request: string,
  parent: NodeModule | undefined,
  isMain: boolean
) => unknown;

let originalLoad: ModuleLoad | null = null;

const outputChannel = {
  appendLine(_line: string): void {
    // Intentionally no-op for deterministic unit tests.
  },
  show(_preserveFocus?: boolean): void {
    // Intentionally no-op for deterministic unit tests.
  },
};

const vscodeMock = {
  window: {
    createOutputChannel() {
      return outputChannel;
    },
  },
  workspace: {
    getConfiguration(_section?: string) {
      return {
        get<T>(key: string, defaultValue?: T): T {
          if (key in r2Config) {
            return r2Config[key as keyof MockR2Config] as unknown as T;
          }
          return defaultValue as T;
        },
      };
    },
  },
};

export function installVscodeModuleMock(): void {
  if (originalLoad) {
    return;
  }

  const moduleWithLoad = Module as any;
  originalLoad = moduleWithLoad._load as ModuleLoad;

  moduleWithLoad._load = function patchedLoad(
    request: string,
    parent: NodeModule,
    isMain: boolean
  ): unknown {
    if (request === "vscode") {
      return vscodeMock;
    }

    return (originalLoad as any).call(this, request, parent, isMain);
  };
}

export function uninstallVscodeModuleMock(): void {
  if (!originalLoad) {
    return;
  }

  const moduleWithLoad = Module as any;
  moduleWithLoad._load = originalLoad;
  originalLoad = null;
  resetMockR2Config();
}

export function setMockR2Config(overrides: Partial<MockR2Config>): void {
  r2Config = { ...r2Config, ...overrides };
}

export function resetMockR2Config(): void {
  r2Config = { ...defaultR2Config };
}
