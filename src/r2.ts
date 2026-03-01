import { readdir, stat, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { existsSync } from "node:fs";

export interface R2Object {
    key: string;
    size: number;
    etag: string;
    uploaded: Date;
    metadata?: Record<string, string>;
    customMetadata?: Record<string, string>;
    httpMetadata?: Record<string, string>;
}

export async function readR2(dirPath: string): Promise<R2Object[]> {
    const objects: R2Object[] = [];

    async function traverse(currentPath: string) {
        let entries;
        try {
            entries = await readdir(currentPath, { withFileTypes: true });
        } catch (e) {
            console.error("Error reading directory", currentPath, e);
            return;
        }

        for (const entry of entries) {
            const fullPath = join(currentPath, entry.name);
            if (entry.isDirectory()) {
                await traverse(fullPath);
            } else if (entry.isFile()) {
                // If it's a .metadata file, check if the corresponding blob exists.
                // If so, it's miniflare's metadata, so we skip it.
                if (entry.name.endsWith('.metadata')) {
                    const blobPath = fullPath.substring(0, fullPath.length - '.metadata'.length);
                    if (existsSync(blobPath)) {
                        continue;
                    }
                }

                try {
                    const stats = await stat(fullPath);
                    const relativePath = relative(dirPath, fullPath).replace(/\\/g, '/');

                    let metadata: Record<string, any> = {};
                    let customMetadata: Record<string, string> | undefined;
                    let httpMetadata: Record<string, string> | undefined;

                    try {
                        const metaPath = `${fullPath}.metadata`;
                        const metaContent = await readFile(metaPath, 'utf-8');
                        const parsedMeta = JSON.parse(metaContent);
                        metadata = parsedMeta;
                        customMetadata = parsedMeta.customMetadata;
                        httpMetadata = parsedMeta.httpMetadata;
                    } catch (metaErr) {
                        // Metadata might not exist, that's fine
                    }

                    objects.push({
                        key: relativePath,
                        size: stats.size,
                        etag: metadata.etag || `W/"${stats.size}-${stats.mtime.getTime()}"`,
                        uploaded: stats.mtime,
                        metadata,
                        customMetadata,
                        httpMetadata
                    });
                } catch (e) {
                    console.error("Error reading file", fullPath, e);
                }
            }
        }
    }

    await traverse(dirPath);
    return objects;
}
