use anyhow::Context;
use opendal::{Operator, services};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection, SqliteRow};
use sqlx::{Column, Connection, Row, TypeInfo, ValueRef};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

#[derive(Deserialize, Debug)]
#[serde(tag = "action")]
enum Action {
    #[serde(rename = "list")]
    List {
        service: String,
        config: HashMap<String, String>,
        path: String,
    },
    #[serde(rename = "read")]
    Read {
        service: String,
        config: HashMap<String, String>,
        path: String,
    },
    #[serde(rename = "write")]
    Write {
        service: String,
        config: HashMap<String, String>,
        path: String,
        content: String,
    },
    #[serde(rename = "delete")]
    Delete {
        service: String,
        config: HashMap<String, String>,
        path: String,
    },
    #[serde(rename = "findRoots")]
    FindRoots { roots: Vec<String> },
    #[serde(rename = "listStorageTypes")]
    ListStorageTypes {
        #[serde(rename = "wranglerDir")]
        wrangler_dir: String,
    },
    #[serde(rename = "listKvNamespaces")]
    ListKvNamespaces {
        #[serde(rename = "wranglerDir")]
        wrangler_dir: String,
    },
    #[serde(rename = "listKvEntries")]
    ListKvEntries {
        #[serde(rename = "wranglerDir")]
        wrangler_dir: String,
        #[serde(rename = "sqlitePath")]
        sqlite_path: String,
        #[serde(rename = "blobsPath")]
        blobs_path: Option<String>,
        prefix: Option<String>,
    },
    #[serde(rename = "listR2Buckets")]
    ListR2Buckets {
        #[serde(rename = "wranglerDir")]
        wrangler_dir: String,
    },
    #[serde(rename = "listR2Objects")]
    ListR2Objects {
        #[serde(rename = "wranglerDir")]
        wrangler_dir: String,
        bucket: String,
        prefix: Option<String>,
    },
    #[serde(rename = "listD1Databases")]
    ListD1Databases {
        #[serde(rename = "wranglerDir")]
        wrangler_dir: String,
    },
    #[serde(rename = "listD1Tables")]
    ListD1Tables {
        #[serde(rename = "sqlitePath")]
        sqlite_path: String,
    },
    #[serde(rename = "listD1Rows")]
    ListD1Rows {
        #[serde(rename = "sqlitePath")]
        sqlite_path: String,
        table: String,
    },
}

#[derive(Serialize)]
struct ListResult {
    entries: Vec<EntryInfo>,
}

#[derive(Serialize)]
struct EntryInfo {
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
struct ReadResult {
    content: String,
}

#[derive(Serialize)]
struct EmptyResult {
    success: bool,
}

#[derive(Serialize)]
struct ErrorResult {
    error: String,
}

#[derive(Serialize)]
struct WranglerRootsResult {
    roots: Vec<String>,
}

#[derive(Serialize)]
struct WranglerStorageTypesResult {
    #[serde(rename = "statePath")]
    state_path: String,
    types: Vec<String>,
}

#[derive(Serialize)]
struct KvNamespacesResult {
    namespaces: Vec<KvNamespaceInfo>,
}

#[derive(Serialize)]
struct KvNamespaceInfo {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    binding: Option<String>,
    #[serde(rename = "blobsPath", skip_serializing_if = "Option::is_none")]
    blobs_path: Option<String>,
    #[serde(rename = "sqlitePath", skip_serializing_if = "Option::is_none")]
    sqlite_path: Option<String>,
}

#[derive(Serialize)]
struct PrefixInfo {
    prefix: String,
}

#[derive(Serialize)]
struct KvListResult {
    prefixes: Vec<PrefixInfo>,
    entries: Vec<KvEntryInfo>,
}

#[derive(Serialize)]
struct KvEntryInfo {
    key: String,
    #[serde(rename = "blobId", skip_serializing_if = "Option::is_none")]
    blob_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expiration: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<String>,
    #[serde(rename = "blobPath", skip_serializing_if = "Option::is_none")]
    blob_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
}

#[derive(Serialize)]
struct R2BucketsResult {
    buckets: Vec<R2BucketInfo>,
}

#[derive(Serialize)]
struct R2BucketInfo {
    name: String,
    #[serde(rename = "blobsPath")]
    blobs_path: String,
}

#[derive(Serialize)]
struct R2ListResult {
    prefixes: Vec<PrefixInfo>,
    objects: Vec<R2ObjectInfo>,
}

#[derive(Serialize)]
struct R2ObjectInfo {
    key: String,
    #[serde(rename = "blobId")]
    blob_id: String,
    size: i64,
    etag: String,
    uploaded: i64,
    #[serde(rename = "blobPath")]
    blob_path: String,
}

#[derive(Serialize)]
struct D1DatabasesResult {
    databases: Vec<D1DatabaseInfo>,
}

#[derive(Serialize)]
struct D1DatabaseInfo {
    #[serde(rename = "sqlitePath")]
    sqlite_path: String,
    #[serde(rename = "displayName")]
    display_name: String,
}

#[derive(Serialize)]
struct D1TablesResult {
    tables: Vec<D1TableInfo>,
}

#[derive(Serialize)]
struct D1TableInfo {
    name: String,
    #[serde(rename = "rowCount")]
    row_count: i64,
}

#[derive(Serialize)]
struct D1RowsResult {
    rows: Vec<JsonMap<String, JsonValue>>,
}

#[derive(Clone)]
struct WranglerD1Config {
    database_name: Option<String>,
    binding: Option<String>,
}

async fn run() -> anyhow::Result<()> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    if input.trim().is_empty() {
        return Err(anyhow::anyhow!("No input provided"));
    }

    let action: Action = serde_json::from_str(&input)?;

    match action {
        Action::List {
            service,
            config,
            path,
        } => {
            let op = build_operator(&service, &config)?;
            let lister = op.list(&path).await?;
            let mut entries = Vec::new();
            for entry in lister {
                entries.push(EntryInfo {
                    path: entry.path().to_string(),
                    is_dir: entry.metadata().is_dir(),
                });
            }
            println!("{}", serde_json::to_string(&ListResult { entries })?);
        }
        Action::Read {
            service,
            config,
            path,
        } => {
            let op = build_operator(&service, &config)?;
            let data = op.read(&path).await?;
            let content = String::from_utf8_lossy(&data.to_vec()).to_string();
            println!("{}", serde_json::to_string(&ReadResult { content })?);
        }
        Action::Write {
            service,
            config,
            path,
            content,
        } => {
            let op = build_operator(&service, &config)?;
            op.write(&path, content).await?;
            println!("{}", serde_json::to_string(&EmptyResult { success: true })?);
        }
        Action::Delete {
            service,
            config,
            path,
        } => {
            let op = build_operator(&service, &config)?;
            op.delete(&path).await?;
            println!("{}", serde_json::to_string(&EmptyResult { success: true })?);
        }
        Action::FindRoots { roots } => {
            let result = WranglerRootsResult {
                roots: list_wrangler_roots(&roots),
            };
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::ListStorageTypes { wrangler_dir } => {
            let result = list_storage_types(&wrangler_dir);
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::ListKvNamespaces { wrangler_dir } => {
            let result = list_kv_namespaces(&wrangler_dir).await?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::ListKvEntries {
            wrangler_dir,
            sqlite_path,
            blobs_path,
            prefix,
        } => {
            let result = list_kv_entries(
                &wrangler_dir,
                &sqlite_path,
                blobs_path.as_deref(),
                prefix.as_deref(),
            )
            .await?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::ListR2Buckets { wrangler_dir } => {
            let result = list_r2_buckets(&wrangler_dir);
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::ListR2Objects {
            wrangler_dir,
            bucket,
            prefix,
        } => {
            let result = list_r2_objects(&wrangler_dir, &bucket, prefix.as_deref()).await?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::ListD1Databases { wrangler_dir } => {
            let result = list_d1_databases(&wrangler_dir);
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::ListD1Tables { sqlite_path } => {
            let result = list_d1_tables(&sqlite_path).await?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::ListD1Rows { sqlite_path, table } => {
            let result = list_d1_rows(&sqlite_path, &table).await?;
            println!("{}", serde_json::to_string(&result)?);
        }
    }

    Ok(())
}

fn build_operator(service: &str, config: &HashMap<String, String>) -> anyhow::Result<Operator> {
    match service {
        "d1" => {
            let mut b = services::D1::default();
            if let Some(t) = config.get("token") {
                b = b.token(t);
            }
            if let Some(a) = config.get("account_id") {
                b = b.account_id(a);
            }
            if let Some(d) = config.get("database_id") {
                b = b.database_id(d);
            }
            Ok(Operator::new(b)?.finish())
        }
        "cloudflare_kv" => {
            let mut b = services::CloudflareKv::default();
            if let Some(t) = config.get("token") {
                b = b.api_token(t);
            }
            if let Some(a) = config.get("account_id") {
                b = b.account_id(a);
            }
            if let Some(n) = config.get("namespace_id") {
                b = b.namespace_id(n);
            }
            Ok(Operator::new(b)?.finish())
        }
        "s3" => {
            let mut b = services::S3::default();
            if let Some(e) = config.get("endpoint") {
                b = b.endpoint(e);
            }
            if let Some(a) = config.get("access_key_id") {
                b = b.access_key_id(a);
            }
            if let Some(s) = config.get("secret_access_key") {
                b = b.secret_access_key(s);
            }
            if let Some(bu) = config.get("bucket") {
                b = b.bucket(bu);
            }
            if let Some(r) = config.get("region") {
                b = b.region(r);
            }
            Ok(Operator::new(b)?.finish())
        }
        _ => Err(anyhow::anyhow!("Unknown service: {}", service)),
    }
}

fn resolve_state_path(wrangler_dir: &str) -> PathBuf {
    Path::new(wrangler_dir).join("state").join("v3")
}

fn safe_read_dir(dir: &Path) -> Vec<fs::DirEntry> {
    match fs::read_dir(dir) {
        Ok(iter) => iter.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}

fn list_subdirs(dir: &Path) -> Vec<String> {
    let mut dirs = safe_read_dir(dir)
        .into_iter()
        .filter_map(|entry| {
            let is_dir = entry.file_type().ok()?.is_dir();
            if !is_dir {
                return None;
            }
            Some(entry.file_name().to_string_lossy().to_string())
        })
        .collect::<Vec<_>>();
    dirs.sort();
    dirs
}

fn list_sqlite_files(dir: &Path) -> Vec<String> {
    let mut files = safe_read_dir(dir)
        .into_iter()
        .filter_map(|entry| {
            let is_file = entry.file_type().ok()?.is_file();
            if !is_file {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".sqlite") {
                return None;
            }
            Some(entry.path().to_string_lossy().to_string())
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

fn strip_json_comments(content: &str) -> String {
    let bytes = content.as_bytes();
    let mut out = String::with_capacity(content.len());
    let mut i = 0usize;
    let mut in_string = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut escaped = false;

    while i < bytes.len() {
        let c = bytes[i] as char;
        let next = if i + 1 < bytes.len() {
            Some(bytes[i + 1] as char)
        } else {
            None
        };

        if in_line_comment {
            if c == '\n' {
                in_line_comment = false;
                out.push('\n');
            }
            i += 1;
            continue;
        }

        if in_block_comment {
            if c == '*' && next == Some('/') {
                in_block_comment = false;
                i += 2;
                continue;
            }
            if c == '\n' {
                out.push('\n');
            }
            i += 1;
            continue;
        }

        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        if c == '"' {
            in_string = true;
            out.push(c);
            i += 1;
            continue;
        }

        if c == '/' && next == Some('/') {
            in_line_comment = true;
            i += 2;
            continue;
        }

        if c == '/' && next == Some('*') {
            in_block_comment = true;
            i += 2;
            continue;
        }

        out.push(c);
        i += 1;
    }

    out
}

fn find_wrangler_config(wrangler_dir: &str) -> Option<JsonValue> {
    let mut current = Path::new(wrangler_dir).parent()?.to_path_buf();

    loop {
        let jsonc_path = current.join("wrangler.jsonc");
        let json_path = current.join("wrangler.json");

        if jsonc_path.exists() {
            let content = fs::read_to_string(jsonc_path).ok()?;
            let stripped = strip_json_comments(&content);
            return serde_json::from_str(&stripped).ok();
        }

        if json_path.exists() {
            let content = fs::read_to_string(json_path).ok()?;
            return serde_json::from_str(&content).ok();
        }

        let Some(parent) = current.parent() else {
            break;
        };
        if parent == current {
            break;
        }
        current = parent.to_path_buf();
    }

    None
}

fn kv_bindings_by_id(config: &JsonValue) -> HashMap<String, String> {
    let mut by_id = HashMap::new();
    let Some(namespaces) = config.get("kv_namespaces").and_then(JsonValue::as_array) else {
        return by_id;
    };

    for ns in namespaces {
        let id = ns.get("id").and_then(JsonValue::as_str);
        let binding = ns.get("binding").and_then(JsonValue::as_str);
        if let (Some(id), Some(binding)) = (id, binding) {
            by_id.insert(id.to_string(), binding.to_string());
        }
    }

    by_id
}

fn d1_configs(config: &JsonValue) -> Vec<WranglerD1Config> {
    config
        .get("d1_databases")
        .and_then(JsonValue::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| WranglerD1Config {
                    database_name: item
                        .get("database_name")
                        .and_then(JsonValue::as_str)
                        .map(ToOwned::to_owned),
                    binding: item
                        .get("binding")
                        .and_then(JsonValue::as_str)
                        .map(ToOwned::to_owned),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn read_first_blob_id(blobs_path: Option<&str>) -> Option<String> {
    let blobs_path = Path::new(blobs_path?);
    let mut files = safe_read_dir(blobs_path)
        .into_iter()
        .filter_map(|entry| {
            let is_file = entry.file_type().ok()?.is_file();
            if !is_file {
                return None;
            }
            Some(entry.file_name().to_string_lossy().to_string())
        })
        .collect::<Vec<_>>();

    files.sort();
    files.into_iter().next()
}

fn resolve_blob_path(blob_id: &str, blob_roots: &[String]) -> Option<String> {
    for root in blob_roots {
        let candidate = Path::new(root).join(blob_id);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn build_prefix_listing<T, F>(
    items: Vec<T>,
    prefix: Option<&str>,
    key_fn: F,
) -> (Vec<String>, Vec<T>)
where
    F: Fn(&T) -> &str,
{
    let base_prefix = prefix.unwrap_or("");
    let mut prefixes = BTreeSet::new();
    let mut objects = Vec::new();

    for item in items {
        let key = key_fn(&item);
        if !base_prefix.is_empty() && !key.starts_with(base_prefix) {
            continue;
        }

        let rest = if base_prefix.is_empty() {
            key
        } else {
            &key[base_prefix.len()..]
        };

        if let Some(slash_index) = rest.find('/') {
            let mut prefix_value = String::from(base_prefix);
            prefix_value.push_str(&rest[..slash_index + 1]);
            prefixes.insert(prefix_value);
            continue;
        }

        objects.push(item);
    }

    objects.sort_by(|a, b| key_fn(a).cmp(key_fn(b)));

    (prefixes.into_iter().collect(), objects)
}

fn list_wrangler_roots(roots: &[String]) -> Vec<String> {
    const SKIP_DIRS: &[&str] = &[
        "node_modules",
        ".git",
        ".hg",
        ".svn",
        ".turbo",
        ".next",
        ".cache",
        "dist",
        "out",
        "build",
        ".vscode",
    ];

    fn walk(dir: &Path, found: &mut BTreeSet<String>) {
        for entry in safe_read_dir(dir) {
            let file_type = match entry.file_type() {
                Ok(v) => v,
                Err(_) => continue,
            };

            if !file_type.is_dir() || file_type.is_symlink() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            let entry_path = entry.path();

            if name.starts_with(".wrangler") {
                found.insert(entry_path.to_string_lossy().to_string());
                continue;
            }

            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }

            walk(&entry_path, found);
        }
    }

    let mut found = BTreeSet::new();

    for root in roots {
        let root_path = Path::new(root);
        if !root_path.exists() {
            continue;
        }
        walk(root_path, &mut found);
    }

    found.into_iter().collect()
}

fn list_storage_types(wrangler_dir: &str) -> WranglerStorageTypesResult {
    let state_path = resolve_state_path(wrangler_dir);
    let mut types = Vec::new();

    if state_path.join("kv").exists() {
        types.push(String::from("kv"));
    }
    if state_path.join("d1").exists() {
        types.push(String::from("d1"));
    }
    if state_path.join("r2").exists() {
        types.push(String::from("r2"));
    }

    WranglerStorageTypesResult {
        state_path: state_path.to_string_lossy().to_string(),
        types,
    }
}

async fn connect_sqlite(sqlite_path: &str) -> anyhow::Result<SqliteConnection> {
    let options = SqliteConnectOptions::new()
        .filename(Path::new(sqlite_path))
        .create_if_missing(false);

    SqliteConnection::connect_with(&options)
        .await
        .with_context(|| format!("Failed to open sqlite database: {sqlite_path}"))
}

async fn sqlite_has_blob(sqlite_path: &str, blob_id: &str) -> bool {
    let mut conn = match connect_sqlite(sqlite_path).await {
        Ok(conn) => conn,
        Err(_) => return false,
    };

    let result =
        sqlx::query_scalar::<_, i64>("SELECT 1 AS ok FROM _mf_entries WHERE blob_id = ? LIMIT 1")
            .bind(blob_id)
            .fetch_optional(&mut conn)
            .await;

    result.map(|row| row.is_some()).unwrap_or(false)
}

async fn list_kv_namespaces(wrangler_dir: &str) -> anyhow::Result<KvNamespacesResult> {
    let state_path = resolve_state_path(wrangler_dir);
    let kv_root = state_path.join("kv");
    if !kv_root.exists() {
        return Ok(KvNamespacesResult {
            namespaces: Vec::new(),
        });
    }

    let config =
        find_wrangler_config(wrangler_dir).unwrap_or(JsonValue::Object(Default::default()));
    let binding_by_id = kv_bindings_by_id(&config);

    let namespace_dirs = list_subdirs(&kv_root)
        .into_iter()
        .filter(|name| name != "miniflare-KVNamespaceObject")
        .collect::<Vec<_>>();

    let sqlite_dir = kv_root.join("miniflare-KVNamespaceObject");
    let sqlite_files = list_sqlite_files(&sqlite_dir);

    let mut namespaces = namespace_dirs
        .into_iter()
        .map(|id| KvNamespaceInfo {
            id: id.clone(),
            binding: binding_by_id.get(&id).cloned(),
            blobs_path: Some(
                kv_root
                    .join(&id)
                    .join("blobs")
                    .to_string_lossy()
                    .to_string(),
            ),
            sqlite_path: None,
        })
        .collect::<Vec<_>>();

    for namespace in &mut namespaces {
        let sample_blob = read_first_blob_id(namespace.blobs_path.as_deref());
        let Some(sample_blob) = sample_blob else {
            continue;
        };

        for sqlite_file in &sqlite_files {
            if sqlite_has_blob(sqlite_file, &sample_blob).await {
                namespace.sqlite_path = Some(sqlite_file.clone());
                break;
            }
        }
    }

    if sqlite_files.len() == 1 && namespaces.len() == 1 && namespaces[0].sqlite_path.is_none() {
        namespaces[0].sqlite_path = Some(sqlite_files[0].clone());
    }

    let mapped_sqlites = namespaces
        .iter()
        .filter_map(|ns| ns.sqlite_path.clone())
        .collect::<BTreeSet<_>>();

    for sqlite_file in sqlite_files {
        if mapped_sqlites.contains(&sqlite_file) {
            continue;
        }

        let id = Path::new(&sqlite_file)
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| String::from("unknown"));

        namespaces.push(KvNamespaceInfo {
            id,
            binding: None,
            blobs_path: None,
            sqlite_path: Some(sqlite_file),
        });
    }

    Ok(KvNamespacesResult { namespaces })
}

async fn list_kv_entries(
    wrangler_dir: &str,
    sqlite_path: &str,
    blobs_path: Option<&str>,
    prefix: Option<&str>,
) -> anyhow::Result<KvListResult> {
    let mut conn = connect_sqlite(sqlite_path).await?;

    let rows = sqlx::query("SELECT key, blob_id, expiration, metadata FROM _mf_entries")
        .fetch_all(&mut conn)
        .await
        .with_context(|| format!("Failed to read KV entries from {sqlite_path}"))?;

    let kv_root = resolve_state_path(wrangler_dir).join("kv");
    let candidate_blob_roots = if let Some(blobs_path) = blobs_path {
        vec![String::from(blobs_path)]
    } else {
        list_subdirs(&kv_root)
            .into_iter()
            .filter(|name| name != "miniflare-KVNamespaceObject")
            .map(|name| {
                kv_root
                    .join(name)
                    .join("blobs")
                    .to_string_lossy()
                    .to_string()
            })
            .collect::<Vec<_>>()
    };

    let entries_with_paths = rows
        .into_iter()
        .map(|row| {
            let key: String = row.try_get("key")?;
            let blob_id: String = row.try_get("blob_id")?;
            let expiration: Option<i64> = row.try_get("expiration").ok();
            let metadata: Option<String> = row.try_get("metadata").ok();

            let blob_path = resolve_blob_path(&blob_id, &candidate_blob_roots);
            let size = blob_path
                .as_ref()
                .and_then(|file| fs::metadata(file).ok())
                .map(|stat| stat.len());

            Ok::<KvEntryInfo, sqlx::Error>(KvEntryInfo {
                key,
                blob_id: Some(blob_id),
                expiration,
                metadata,
                blob_path,
                size,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    let (prefixes, entries) = build_prefix_listing(entries_with_paths, prefix, |entry| &entry.key);

    Ok(KvListResult {
        prefixes: prefixes
            .into_iter()
            .map(|prefix| PrefixInfo { prefix })
            .collect(),
        entries,
    })
}

fn list_r2_buckets(wrangler_dir: &str) -> R2BucketsResult {
    let state_path = resolve_state_path(wrangler_dir);
    let r2_root = state_path.join("r2");
    if !r2_root.exists() {
        return R2BucketsResult {
            buckets: Vec::new(),
        };
    }

    let buckets = list_subdirs(&r2_root)
        .into_iter()
        .filter(|name| name != "miniflare-R2BucketObject")
        .map(|name| R2BucketInfo {
            blobs_path: r2_root
                .join(&name)
                .join("blobs")
                .to_string_lossy()
                .to_string(),
            name,
        })
        .collect();

    R2BucketsResult { buckets }
}

async fn list_r2_objects(
    wrangler_dir: &str,
    bucket: &str,
    prefix: Option<&str>,
) -> anyhow::Result<R2ListResult> {
    let state_path = resolve_state_path(wrangler_dir);
    let sqlite_dir = state_path.join("r2").join("miniflare-R2BucketObject");
    let sqlite_files = list_sqlite_files(&sqlite_dir);

    if sqlite_files.is_empty() {
        return Ok(R2ListResult {
            prefixes: Vec::new(),
            objects: Vec::new(),
        });
    }

    let blobs_path = state_path.join("r2").join(bucket).join("blobs");
    let blob_roots = vec![blobs_path.to_string_lossy().to_string()];

    let mut conn = connect_sqlite(&sqlite_files[0]).await?;
    let rows = sqlx::query("SELECT key, blob_id, size, etag, uploaded FROM _mf_objects")
        .fetch_all(&mut conn)
        .await
        .with_context(|| format!("Failed to read R2 objects from {}", sqlite_files[0]))?;

    let objects = rows
        .into_iter()
        .filter_map(|row| {
            let key: String = row.try_get("key").ok()?;
            let blob_id: String = row.try_get("blob_id").ok()?;
            let size: i64 = row.try_get("size").ok()?;
            let etag: String = row.try_get("etag").ok()?;
            let uploaded: i64 = row.try_get("uploaded").ok()?;

            let blob_path = resolve_blob_path(&blob_id, &blob_roots)?;

            Some(R2ObjectInfo {
                key,
                blob_id,
                size,
                etag,
                uploaded,
                blob_path,
            })
        })
        .collect::<Vec<_>>();

    let (prefixes, objects) = build_prefix_listing(objects, prefix, |item| &item.key);

    Ok(R2ListResult {
        prefixes: prefixes
            .into_iter()
            .map(|prefix| PrefixInfo { prefix })
            .collect(),
        objects,
    })
}

fn list_d1_databases(wrangler_dir: &str) -> D1DatabasesResult {
    let state_path = resolve_state_path(wrangler_dir);
    let d1_dir = state_path.join("d1").join("miniflare-D1DatabaseObject");
    if !d1_dir.exists() {
        return D1DatabasesResult {
            databases: Vec::new(),
        };
    }

    let sqlite_files = list_sqlite_files(&d1_dir);
    let config =
        find_wrangler_config(wrangler_dir).unwrap_or(JsonValue::Object(Default::default()));
    let d1_configs = d1_configs(&config);
    let single_config = if d1_configs.len() == 1 {
        d1_configs.first().cloned()
    } else {
        None
    };

    let databases = sqlite_files
        .into_iter()
        .map(|sqlite_path| {
            let display_name = single_config
                .as_ref()
                .and_then(|cfg| cfg.database_name.clone().or(cfg.binding.clone()))
                .unwrap_or_else(|| {
                    Path::new(&sqlite_path)
                        .file_stem()
                        .map(|stem| stem.to_string_lossy().to_string())
                        .unwrap_or_else(|| String::from("d1"))
                });

            D1DatabaseInfo {
                sqlite_path,
                display_name,
            }
        })
        .collect();

    D1DatabasesResult { databases }
}

async fn list_d1_tables(sqlite_path: &str) -> anyhow::Result<D1TablesResult> {
    let mut conn = connect_sqlite(sqlite_path).await?;

    let table_rows = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_cf_METADATA'",
    )
    .fetch_all(&mut conn)
    .await
    .with_context(|| format!("Failed to list tables for {sqlite_path}"))?;

    let mut tables = Vec::new();

    for row in table_rows {
        let name: String = row.try_get("name")?;
        let quoted_name = quote_identifier(&name);
        let count_sql = format!("SELECT COUNT(*) as count FROM {quoted_name}");
        let row_count = sqlx::query_scalar::<_, i64>(&count_sql)
            .fetch_one(&mut conn)
            .await
            .unwrap_or(0);

        tables.push(D1TableInfo { name, row_count });
    }

    Ok(D1TablesResult { tables })
}

fn is_supported_identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

fn sqlite_cell_to_json(row: &SqliteRow, idx: usize) -> anyhow::Result<JsonValue> {
    let raw = row
        .try_get_raw(idx)
        .map_err(|err| anyhow::anyhow!("failed to read sqlite cell: {err}"))?;

    if raw.is_null() {
        return Ok(JsonValue::Null);
    }

    match raw.type_info().name() {
        "INTEGER" => Ok(JsonValue::from(row.try_get::<i64, _>(idx)?)),
        "REAL" => Ok(JsonValue::from(row.try_get::<f64, _>(idx)?)),
        "BLOB" => {
            let bytes = row.try_get::<Vec<u8>, _>(idx)?;
            let encoded = bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            Ok(JsonValue::String(format!("0x{encoded}")))
        }
        _ => Ok(JsonValue::String(row.try_get::<String, _>(idx)?)),
    }
}

fn sqlite_row_to_json(row: &SqliteRow) -> anyhow::Result<JsonMap<String, JsonValue>> {
    let mut out = JsonMap::new();

    for (idx, column) in row.columns().iter().enumerate() {
        let value = sqlite_cell_to_json(row, idx)?;
        out.insert(column.name().to_string(), value);
    }

    Ok(out)
}

async fn list_d1_rows(sqlite_path: &str, table: &str) -> anyhow::Result<D1RowsResult> {
    if !is_supported_identifier(table) {
        return Err(anyhow::anyhow!("Unsupported table name: {table}"));
    }

    let mut conn = connect_sqlite(sqlite_path).await?;
    let quoted_table = quote_identifier(table);
    let query = format!("SELECT rowid, * FROM {quoted_table}");

    let rows = sqlx::query(&query)
        .fetch_all(&mut conn)
        .await
        .with_context(|| format!("Failed to list rows for table {table}"))?;

    let json_rows = rows
        .iter()
        .map(sqlite_row_to_json)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(D1RowsResult { rows: json_rows })
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        println!(
            "{}",
            serde_json::to_string(&ErrorResult {
                error: e.to_string()
            })
            .unwrap()
        );
        std::process::exit(1);
    }
}
