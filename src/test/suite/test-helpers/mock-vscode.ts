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

class ThemeIcon {
  constructor(public readonly id: string) {}
}

class TreeItem {
  label: string | { label: string };
  collapsibleState: number;
  contextValue?: string;
  iconPath?: ThemeIcon;
  tooltip?: string;
  description?: string;
  command?: { command: string; title: string; arguments?: unknown[] };

  constructor(label: string | { label: string }, collapsibleState: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class EventEmitter<T = unknown> {
  private listeners: Array<(event: T) => unknown> = [];

  readonly event = (listener: (event: T) => unknown) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter(
          (existing) => existing !== listener
        );
      },
    };
  };

  fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

class Uri {
  constructor(public readonly fsPath: string) {}

  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }
}

const outputChannel = {
  appendLine(_line: string): void {
    // Intentionally no-op for deterministic unit tests.
  },
  show(_preserveFocus?: boolean): void {
    // Intentionally no-op for deterministic unit tests.
  },
};

const vscodeMock = {
  TreeItem,
  ThemeIcon,
  EventEmitter,
  Uri,
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  ViewColumn: {
    Active: 1,
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
  window: {
    createOutputChannel() {
      return outputChannel;
    },
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showQuickPick: async () => undefined,
    createTreeView: () => ({ dispose() {} }),
    createWebviewPanel: () => ({
      webview: {
        html: "",
        onDidReceiveMessage: () => ({ dispose() {} }),
        postMessage: async () => true,
      },
      onDidDispose: () => ({ dispose() {} }),
      dispose() {},
    }),
  },
  workspace: {
    workspaceFolders: undefined as unknown,
    getConfiguration(_section?: string) {
      return {
        get<T>(key: string, defaultValue?: T): T {
          if (key in r2Config) {
            return r2Config[key as keyof MockR2Config] as unknown as T;
          }
          return defaultValue as T;
        },
        update: async () => undefined,
      };
    },
    registerFileSystemProvider: () => ({ dispose() {} }),
  },
  commands: {
    executeCommand: async () => undefined,
    registerCommand: () => ({ dispose() {} }),
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
