import * as assert from "assert";
import {
  installVscodeModuleMock,
  uninstallVscodeModuleMock,
} from "./test-helpers/mock-vscode";
import { S3Explorer } from "../../tree/explorer";
import {
  RemoteStorageRootNode,
  isRemoteKvNamespaceNode,
} from "../../tree/remoteNodes";

type ListingModule = typeof import("../../s3/listing");
type RemoteClientModule = typeof import("../../remote-bindings/client");

const listing = require("../../s3/listing") as ListingModule;
const remoteClient = require("../../remote-bindings/client") as RemoteClientModule;

describe("Remote Explorer Hierarchy (Unit)", () => {
  const originalListingFns = {
    listBuckets: listing.listBuckets,
    listObjects: listing.listObjects,
  };

  const originalRemoteFns = {
    listRemoteD1Databases: remoteClient.listRemoteD1Databases,
    listRemoteKvNamespaces: remoteClient.listRemoteKvNamespaces,
    listRemoteKvEntries: remoteClient.listRemoteKvEntries,
    clearRemoteBindingsCache: remoteClient.clearRemoteBindingsCache,
  };

  before(() => {
    installVscodeModuleMock();
  });

  beforeEach(() => {
    (listing as any).listBuckets = originalListingFns.listBuckets;
    (listing as any).listObjects = originalListingFns.listObjects;
    (remoteClient as any).listRemoteD1Databases =
      originalRemoteFns.listRemoteD1Databases;
    (remoteClient as any).listRemoteKvNamespaces =
      originalRemoteFns.listRemoteKvNamespaces;
    (remoteClient as any).listRemoteKvEntries = originalRemoteFns.listRemoteKvEntries;
    (remoteClient as any).clearRemoteBindingsCache =
      originalRemoteFns.clearRemoteBindingsCache;
  });

  after(() => {
    uninstallVscodeModuleMock();
  });

  it("shows remote D1/R2/KV root folders in the main explorer", async () => {
    const explorer = new S3Explorer();
    const roots = await explorer.getChildren();

    assert.deepStrictEqual(
      roots.map((node) =>
        typeof node.label === "string" ? node.label : node.label?.label
      ),
      ["D1", "R2", "KV"]
    );
  });

  it("loads remote D1 databases as click-to-open nodes", async () => {
    const explorer = new S3Explorer();
    (remoteClient as any).listRemoteD1Databases = async () => [
      { id: "db-1", name: "Primary DB" },
    ];

    const children = await explorer.getChildren(new RemoteStorageRootNode("d1"));

    assert.strictEqual(children.length, 2);
    assert.strictEqual(children[0]?.contextValue, "remoteMessage");
    assert.strictEqual(children[1]?.contextValue, "remoteD1Database");
    assert.strictEqual(children[1]?.command?.command, "remoteBindings.openD1Database");
  });

  it("loads remote KV namespaces and namespace children", async () => {
    const explorer = new S3Explorer();
    (remoteClient as any).listRemoteKvNamespaces = async () => [
      { id: "ns-1", title: "sessions" },
    ];
    (remoteClient as any).listRemoteKvEntries = async () => ({
      prefixes: [{ prefix: "users/" }],
      entries: [{ key: "users/session-1" }],
      cursor: "cursor-next",
      isTruncated: true,
    });

    const namespaces = await explorer.getChildren(new RemoteStorageRootNode("kv"));
    assert.strictEqual(namespaces.length, 1);
    assert.ok(isRemoteKvNamespaceNode(namespaces[0]));

    const kvChildren = await explorer.getChildren(namespaces[0]);
    assert.deepStrictEqual(
      kvChildren.map((node) => node.contextValue),
      ["remoteKvPrefix", "remoteKvEntry", "remoteKvLoadMore"]
    );
  });

  it("loads R2 buckets under the R2 root group", async () => {
    const explorer = new S3Explorer();
    (listing as any).listBuckets = async () => [{ name: "assets" }];

    const children = await explorer.getChildren(new RemoteStorageRootNode("r2"));
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0]?.contextValue, "bucket");
  });
});
