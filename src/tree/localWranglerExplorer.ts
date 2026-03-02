import * as path from "node:path";
import * as vscode from "vscode";
import {
  BunNotFoundError,
  findWranglerRoots,
  listD1Databases,
  listD1Rows,
  listD1Tables,
  listKvEntries,
  listKvNamespaces,
  listR2Buckets,
  listR2Objects,
  listStorageTypes,
} from "../local-wrangler/client";
import {
  LocalWranglerNode,
  MessageNode,
  WranglerD1DatabaseNode,
  WranglerD1RowNode,
  WranglerD1TableNode,
  WranglerKvEntryNode,
  WranglerKvNamespaceNode,
  WranglerKvPrefixNode,
  WranglerR2BucketNode,
  WranglerR2ObjectNode,
  WranglerR2PrefixNode,
  WranglerRootNode,
  WranglerStorageTypeNode,
  isWranglerD1DatabaseNode,
  isWranglerD1RowNode,
  isWranglerD1TableNode,
  isWranglerKvNamespaceNode,
  isWranglerKvPrefixNode,
  isWranglerR2BucketNode,
  isWranglerR2PrefixNode,
  isWranglerRootNode,
  isWranglerStorageTypeNode,
} from "./localWranglerNodes";

export class LocalWranglerExplorer
  implements vscode.TreeDataProvider<LocalWranglerNode>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    LocalWranglerNode | undefined | null | void
  > = new vscode.EventEmitter<LocalWranglerNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    LocalWranglerNode | undefined | null | void
  > = this._onDidChangeTreeData.event;

  refresh(element?: LocalWranglerNode): void {
    this._onDidChangeTreeData.fire(element);
  }

  getTreeItem(element: LocalWranglerNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: LocalWranglerNode): Promise<LocalWranglerNode[]> {
    try {
      if (!element) {
        return await this.getRoots();
      }

      if (isWranglerRootNode(element)) {
        return await this.getStorageTypes(element);
      }

      if (isWranglerStorageTypeNode(element)) {
        switch (element.storageType) {
          case "kv":
            return await this.getKvNamespaces(element);
          case "r2":
            return await this.getR2Buckets(element);
          case "d1":
            return await this.getD1Databases(element);
          default:
            return [];
        }
      }

      if (isWranglerKvNamespaceNode(element)) {
        return await this.getKvEntries(element, undefined);
      }

      if (isWranglerKvPrefixNode(element)) {
        return await this.getKvEntries(element, element.prefix);
      }

      if (isWranglerR2BucketNode(element)) {
        return await this.getR2Objects(element, undefined);
      }

      if (isWranglerR2PrefixNode(element)) {
        return await this.getR2Objects(element, element.prefix);
      }

      if (isWranglerD1DatabaseNode(element)) {
        return await this.getD1Tables(element);
      }

      if (isWranglerD1TableNode(element)) {
        return await this.getD1Rows(element);
      }

      if (isWranglerD1RowNode(element)) {
        return [];
      }

      return [];
    } catch (error) {
      if (error instanceof BunNotFoundError) {
        return [
          new MessageNode(
            "Bun runtime not found. Install Bun to explore local Wrangler storage.",
            "Install Bun from https://bun.sh and ensure it is available on PATH."
          ),
        ];
      }

      const message = error instanceof Error ? error.message : String(error);
      return [new MessageNode(`Wrangler explorer error: ${message}`)];
    }
  }

  private async getRoots(): Promise<LocalWranglerNode[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [
        new MessageNode("Open a workspace to scan for .wrangler directories."),
      ];
    }

    const roots = await findWranglerRoots(
      workspaceFolders.map((folder) => folder.uri.fsPath)
    );

    if (roots.length === 0) {
      return [new MessageNode("No .wrangler directories found.")];
    }

    return roots.map((wranglerPath) => {
      const label = formatWranglerRootLabel(wranglerPath, workspaceFolders);
      return new WranglerRootNode(label, wranglerPath);
    });
  }

  private async getStorageTypes(
    root: WranglerRootNode
  ): Promise<LocalWranglerNode[]> {
    const result = await listStorageTypes(root.wranglerPath);

    if (result.types.length === 0) {
      return [new MessageNode("No Wrangler storage state found in this root.")];
    }

    return result.types.map(
      (storageType) => new WranglerStorageTypeNode(root.wranglerPath, storageType)
    );
  }

  private async getKvNamespaces(
    storageNode: WranglerStorageTypeNode
  ): Promise<LocalWranglerNode[]> {
    const namespaces = await listKvNamespaces(storageNode.wranglerPath);
    if (namespaces.length === 0) {
      return [new MessageNode("No KV namespaces found.")];
    }

    return namespaces.map(
      (namespace) => new WranglerKvNamespaceNode(storageNode.wranglerPath, namespace)
    );
  }

  private async getKvEntries(
    node: WranglerKvNamespaceNode | WranglerKvPrefixNode,
    prefix?: string
  ): Promise<LocalWranglerNode[]> {
    const namespace = node.namespace;
    if (!namespace.sqlitePath) {
      return [new MessageNode("KV metadata database not found for this namespace.")];
    }

    const result = await listKvEntries({
      wranglerDir: node.wranglerPath,
      sqlitePath: namespace.sqlitePath,
      blobsPath: namespace.blobsPath,
      prefix,
    });

    const nodes: LocalWranglerNode[] = [];
    for (const prefixEntry of result.prefixes) {
      nodes.push(
        new WranglerKvPrefixNode(
          node.wranglerPath,
          namespace,
          prefixEntry.prefix,
          prefix
        )
      );
    }

    for (const entry of result.entries) {
      nodes.push(
        new WranglerKvEntryNode(
          node.wranglerPath,
          namespace,
          entry,
          prefix
        )
      );
    }

    if (nodes.length === 0) {
      return [new MessageNode("No KV keys found.")];
    }

    return nodes;
  }

  private async getR2Buckets(
    storageNode: WranglerStorageTypeNode
  ): Promise<LocalWranglerNode[]> {
    const buckets = await listR2Buckets(storageNode.wranglerPath);
    if (buckets.length === 0) {
      return [new MessageNode("No local R2 buckets found.")];
    }

    return buckets.map(
      (bucket) => new WranglerR2BucketNode(storageNode.wranglerPath, bucket.name)
    );
  }

  private async getR2Objects(
    node: WranglerR2BucketNode | WranglerR2PrefixNode,
    prefix?: string
  ): Promise<LocalWranglerNode[]> {
    const bucket = node.bucket;
    const result = await listR2Objects({
      wranglerDir: node.wranglerPath,
      bucket,
      prefix,
    });

    const nodes: LocalWranglerNode[] = [];
    for (const prefixEntry of result.prefixes) {
      nodes.push(
        new WranglerR2PrefixNode(
          node.wranglerPath,
          bucket,
          prefixEntry.prefix,
          prefix
        )
      );
    }

    for (const object of result.objects) {
      nodes.push(
        new WranglerR2ObjectNode(node.wranglerPath, bucket, object, prefix)
      );
    }

    if (nodes.length === 0) {
      return [new MessageNode("No R2 objects found.")];
    }

    return nodes;
  }

  private async getD1Databases(
    storageNode: WranglerStorageTypeNode
  ): Promise<LocalWranglerNode[]> {
    const databases = await listD1Databases(storageNode.wranglerPath);
    if (databases.length === 0) {
      return [new MessageNode("No D1 databases found.")];
    }

    return databases.map(
      (db) =>
        new WranglerD1DatabaseNode(
          storageNode.wranglerPath,
          db.sqlitePath,
          db.displayName
        )
    );
  }

  private async getD1Tables(
    databaseNode: WranglerD1DatabaseNode
  ): Promise<LocalWranglerNode[]> {
    const tables = await listD1Tables({ sqlitePath: databaseNode.sqlitePath });

    if (tables.length === 0) {
      return [new MessageNode("No tables found in this D1 database.")];
    }

    return tables.map(
      (table) =>
        new WranglerD1TableNode(
          databaseNode.wranglerPath,
          databaseNode.sqlitePath,
          table
        )
    );
  }

  private async getD1Rows(
    tableNode: WranglerD1TableNode
  ): Promise<LocalWranglerNode[]> {
    const result = await listD1Rows({
      sqlitePath: tableNode.sqlitePath,
      table: tableNode.table.name,
    });

    if (result.rows.length === 0) {
      return [new MessageNode("No rows found in this table.")];
    }

    return result.rows.map(
      (row, index) =>
        new WranglerD1RowNode(
          tableNode.wranglerPath,
          tableNode.sqlitePath,
          tableNode.table.name,
          row,
          index
        )
    );
  }
}

function formatWranglerRootLabel(
  wranglerPath: string,
  workspaceFolders: readonly vscode.WorkspaceFolder[]
): string {
  for (const folder of workspaceFolders) {
    if (wranglerPath.startsWith(folder.uri.fsPath)) {
      const relative = path.relative(folder.uri.fsPath, wranglerPath);
      if (relative && !relative.startsWith("..")) {
        return relative || path.basename(wranglerPath);
      }
    }
  }

  return wranglerPath;
}
