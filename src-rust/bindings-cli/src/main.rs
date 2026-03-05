use anyhow::Context;
use keyring::{Entry as KeyringEntry, Error as KeyringError};
use opendal::{Operator, services};
use reqwest::{Client, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection, SqliteRow};
use sqlx::{Column, Connection, Row, TypeInfo, ValueRef};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
    #[serde(rename = "listRemoteD1Databases")]
    ListRemoteD1Databases {
        #[serde(rename = "accountId")]
        account_id: String,
        #[serde(rename = "apiToken")]
        api_token: String,
        page: Option<u32>,
        #[serde(rename = "perPage")]
        per_page: Option<u32>,
    },
    #[serde(rename = "materializeRemoteD1Database")]
    MaterializeRemoteD1Database {
        #[serde(rename = "accountId")]
        account_id: String,
        #[serde(rename = "apiToken")]
        api_token: String,
        #[serde(rename = "databaseId")]
        database_id: String,
        #[serde(rename = "databaseName")]
        database_name: Option<String>,
        #[serde(rename = "forceRefresh")]
        force_refresh: Option<bool>,
        #[serde(rename = "maxTables")]
        max_tables: Option<usize>,
        #[serde(rename = "maxRowsPerTable")]
        max_rows_per_table: Option<usize>,
    },
    #[serde(rename = "executeRemoteD1Sql")]
    ExecuteRemoteD1Sql {
        #[serde(rename = "accountId")]
        account_id: String,
        #[serde(rename = "apiToken")]
        api_token: String,
        #[serde(rename = "databaseId")]
        database_id: String,
        sql: String,
    },
    #[serde(rename = "listRemoteKvNamespaces")]
    ListRemoteKvNamespaces {
        #[serde(rename = "accountId")]
        account_id: String,
        #[serde(rename = "apiToken")]
        api_token: String,
        page: Option<u32>,
        #[serde(rename = "perPage")]
        per_page: Option<u32>,
    },
    #[serde(rename = "listRemoteKvEntries")]
    ListRemoteKvEntries {
        #[serde(rename = "accountId")]
        account_id: String,
        #[serde(rename = "apiToken")]
        api_token: String,
        #[serde(rename = "namespaceId")]
        namespace_id: String,
        prefix: Option<String>,
        cursor: Option<String>,
        limit: Option<u32>,
    },
    #[serde(rename = "readRemoteKvValue")]
    ReadRemoteKvValue {
        #[serde(rename = "accountId")]
        account_id: String,
        #[serde(rename = "apiToken")]
        api_token: String,
        #[serde(rename = "namespaceId")]
        namespace_id: String,
        key: String,
    },
    #[serde(rename = "setSecret")]
    SetSecret { name: String, value: String },
    #[serde(rename = "getSecret")]
    GetSecret { name: String },
    #[serde(rename = "deleteSecret")]
    DeleteSecret { name: String },
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

#[derive(Serialize)]
struct RemoteD1DatabasesResult {
    databases: Vec<RemoteD1DatabaseInfo>,
    page: u32,
    #[serde(rename = "hasMore")]
    has_more: bool,
}

#[derive(Serialize)]
struct RemoteD1DatabaseInfo {
    id: String,
    name: String,
    #[serde(rename = "createdAt", skip_serializing_if = "Option::is_none")]
    created_at: Option<String>,
}

#[derive(Serialize)]
struct RemoteD1SnapshotResult {
    #[serde(rename = "sqlitePath")]
    sqlite_path: String,
    #[serde(rename = "fromCache")]
    from_cache: bool,
    #[serde(rename = "tableCount")]
    table_count: usize,
    #[serde(rename = "rowLimit")]
    row_limit: usize,
    #[serde(rename = "databaseId")]
    database_id: String,
    #[serde(rename = "databaseName")]
    database_name: String,
}

#[derive(Serialize)]
struct RemoteD1QueryResult {
    rows: Vec<JsonMap<String, JsonValue>>,
}

#[derive(Serialize)]
struct RemoteKvNamespacesResult {
    namespaces: Vec<RemoteKvNamespaceInfo>,
    page: u32,
    #[serde(rename = "hasMore")]
    has_more: bool,
}

#[derive(Serialize)]
struct RemoteKvNamespaceInfo {
    id: String,
    title: String,
    #[serde(
        rename = "supportsUrlEncoding",
        skip_serializing_if = "Option::is_none"
    )]
    supports_url_encoding: Option<bool>,
}

#[derive(Serialize)]
struct RemoteKvListResult {
    prefixes: Vec<PrefixInfo>,
    entries: Vec<RemoteKvEntryInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<String>,
    #[serde(rename = "isTruncated")]
    is_truncated: bool,
}

#[derive(Serialize)]
struct RemoteKvEntryInfo {
    key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    expiration: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<String>,
}

#[derive(Serialize)]
struct RemoteKvValueResult {
    content: String,
}

#[derive(Serialize)]
struct SecretResult {
    value: Option<String>,
}

#[derive(Clone)]
struct WranglerD1Config {
    database_name: Option<String>,
    binding: Option<String>,
}

#[derive(Deserialize)]
struct CloudflareEnvelope<T> {
    success: bool,
    result: T,
    #[serde(default)]
    errors: Vec<CloudflareApiError>,
    #[serde(rename = "result_info")]
    result_info: Option<CloudflareResultInfo>,
}

#[derive(Deserialize)]
struct CloudflareApiError {
    code: Option<i64>,
    message: Option<String>,
}

#[derive(Deserialize, Default)]
struct CloudflareResultInfo {
    #[serde(rename = "total_pages")]
    total_pages: Option<u32>,
    cursor: Option<String>,
}

#[derive(Deserialize)]
struct CloudflareD1DatabaseApi {
    uuid: String,
    name: String,
    #[serde(rename = "created_at")]
    created_at: Option<String>,
}

#[derive(Deserialize)]
struct CloudflareKvNamespaceApi {
    id: String,
    title: String,
    supports_url_encoding: Option<bool>,
}

#[derive(Deserialize)]
struct CloudflareKvKeyApi {
    name: String,
    expiration: Option<i64>,
    metadata: Option<JsonValue>,
}

#[derive(Deserialize)]
struct CloudflareD1QueryResultApi {
    #[serde(default)]
    results: Vec<JsonMap<String, JsonValue>>,
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
        Action::ListRemoteD1Databases {
            account_id,
            api_token,
            page,
            per_page,
        } => {
            let result = list_remote_d1_databases(
                &account_id,
                &api_token,
                page.unwrap_or(1),
                per_page.unwrap_or(100),
            )
            .await?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::MaterializeRemoteD1Database {
            account_id,
            api_token,
            database_id,
            database_name,
            force_refresh,
            max_tables,
            max_rows_per_table,
        } => {
            let result = materialize_remote_d1_database(
                &account_id,
                &api_token,
                &database_id,
                database_name.as_deref(),
                force_refresh.unwrap_or(false),
                max_tables.unwrap_or(25),
                max_rows_per_table.unwrap_or(200),
            )
            .await?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::ExecuteRemoteD1Sql {
            account_id,
            api_token,
            database_id,
            sql,
        } => {
            let rows = query_remote_d1(&account_id, &api_token, &database_id, &sql).await?;
            println!(
                "{}",
                serde_json::to_string(&RemoteD1QueryResult { rows })?
            );
        }
        Action::ListRemoteKvNamespaces {
            account_id,
            api_token,
            page,
            per_page,
        } => {
            let result = list_remote_kv_namespaces(
                &account_id,
                &api_token,
                page.unwrap_or(1),
                per_page.unwrap_or(100),
            )
            .await?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::ListRemoteKvEntries {
            account_id,
            api_token,
            namespace_id,
            prefix,
            cursor,
            limit,
        } => {
            let result = list_remote_kv_entries(
                &account_id,
                &api_token,
                &namespace_id,
                prefix.as_deref(),
                cursor.as_deref(),
                limit.unwrap_or(200),
            )
            .await?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::ReadRemoteKvValue {
            account_id,
            api_token,
            namespace_id,
            key,
        } => {
            let result = read_remote_kv_value(&account_id, &api_token, &namespace_id, &key).await?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::SetSecret { name, value } => {
            set_secret(&name, &value)?;
            println!("{}", serde_json::to_string(&EmptyResult { success: true })?);
        }
        Action::GetSecret { name } => {
            let value = get_secret(&name)?;
            println!("{}", serde_json::to_string(&SecretResult { value })?);
        }
        Action::DeleteSecret { name } => {
            delete_secret(&name)?;
            println!("{}", serde_json::to_string(&EmptyResult { success: true })?);
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

            if name.starts_with(".wrangler") || name.starts_with("wrangler") {
                if wrangler_dir_has_storage_data(&entry_path) {
                    found.insert(entry_path.to_string_lossy().to_string());
                }
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

    if wrangler_storage_type_has_data(Path::new(wrangler_dir), "kv") {
        types.push(String::from("kv"));
    }
    if wrangler_storage_type_has_data(Path::new(wrangler_dir), "d1") {
        types.push(String::from("d1"));
    }
    if wrangler_storage_type_has_data(Path::new(wrangler_dir), "r2") {
        types.push(String::from("r2"));
    }

    WranglerStorageTypesResult {
        state_path: state_path.to_string_lossy().to_string(),
        types,
    }
}

fn directory_has_file_recursive(dir: &Path) -> bool {
    if !dir.exists() {
        return false;
    }

    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in safe_read_dir(&current) {
            let file_type = match entry.file_type() {
                Ok(v) => v,
                Err(_) => continue,
            };

            if file_type.is_symlink() {
                continue;
            }

            if file_type.is_file() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.starts_with('.') {
                    continue;
                }
                return true;
            }

            if file_type.is_dir() {
                stack.push(entry.path());
            }
        }
    }

    false
}

fn wrangler_storage_type_has_data(wrangler_dir: &Path, storage_type: &str) -> bool {
    let storage_root = wrangler_dir.join("state").join("v3").join(storage_type);
    directory_has_file_recursive(&storage_root)
}

fn wrangler_dir_has_storage_data(wrangler_dir: &Path) -> bool {
    ["kv", "d1", "r2"]
        .iter()
        .any(|storage_type| wrangler_storage_type_has_data(wrangler_dir, storage_type))
}

const KEYRING_SERVICE: &str = "cloudflare-bindings-explorer";

fn keyring_entry(name: &str) -> anyhow::Result<KeyringEntry> {
    KeyringEntry::new(KEYRING_SERVICE, name).context("Failed to initialize keyring entry")
}

fn set_secret(name: &str, value: &str) -> anyhow::Result<()> {
    let entry = keyring_entry(name)?;
    entry
        .set_password(value)
        .with_context(|| format!("Failed to store secret in keyring: {name}"))?;
    Ok(())
}

fn get_secret(name: &str) -> anyhow::Result<Option<String>> {
    let entry = keyring_entry(name)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => {
            Err(error).with_context(|| format!("Failed to read secret from keyring: {name}"))
        }
    }
}

fn delete_secret(name: &str) -> anyhow::Result<()> {
    let entry = keyring_entry(name)?;
    match entry.delete_credential() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => {
            Err(error).with_context(|| format!("Failed to delete secret from keyring: {name}"))
        }
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

async fn connect_sqlite_with_create(
    sqlite_path: &str,
    create_if_missing: bool,
) -> anyhow::Result<SqliteConnection> {
    let options = SqliteConnectOptions::new()
        .filename(Path::new(sqlite_path))
        .create_if_missing(create_if_missing);

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

fn cloudflare_client() -> anyhow::Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .context("Failed to initialize Cloudflare API HTTP client")
}

fn cloudflare_api_error_message<T>(envelope: &CloudflareEnvelope<T>) -> String {
    if envelope.errors.is_empty() {
        return String::from("Cloudflare API returned an unknown error.");
    }

    envelope
        .errors
        .iter()
        .map(|error| {
            let code = error
                .code
                .map(|value| format!(" [{value}]"))
                .unwrap_or_default();
            let message = error
                .message
                .clone()
                .unwrap_or_else(|| String::from("Unknown error"));
            format!("{message}{code}")
        })
        .collect::<Vec<_>>()
        .join("; ")
}

async fn cloudflare_get_json<T: DeserializeOwned>(
    url: Url,
    api_token: &str,
) -> anyhow::Result<CloudflareEnvelope<T>> {
    let client = cloudflare_client()?;
    let response = client
        .get(url.clone())
        .bearer_auth(api_token)
        .send()
        .await
        .with_context(|| format!("Cloudflare API request failed: GET {url}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .with_context(|| format!("Failed to read Cloudflare API response: GET {url}"))?;

    if !status.is_success() {
        return Err(anyhow::anyhow!(
            "Cloudflare API request failed ({status}) for GET {url}: {body}"
        ));
    }

    let envelope: CloudflareEnvelope<T> = serde_json::from_str(&body)
        .with_context(|| format!("Failed to parse Cloudflare API JSON response for GET {url}"))?;

    if !envelope.success {
        return Err(anyhow::anyhow!(
            "Cloudflare API GET {url} reported failure: {}",
            cloudflare_api_error_message(&envelope)
        ));
    }

    Ok(envelope)
}

async fn cloudflare_post_json<T: DeserializeOwned>(
    url: Url,
    api_token: &str,
    payload: &JsonValue,
) -> anyhow::Result<CloudflareEnvelope<T>> {
    let client = cloudflare_client()?;
    let response = client
        .post(url.clone())
        .bearer_auth(api_token)
        .json(payload)
        .send()
        .await
        .with_context(|| format!("Cloudflare API request failed: POST {url}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .with_context(|| format!("Failed to read Cloudflare API response: POST {url}"))?;

    if !status.is_success() {
        return Err(anyhow::anyhow!(
            "Cloudflare API request failed ({status}) for POST {url}: {body}"
        ));
    }

    let envelope: CloudflareEnvelope<T> = serde_json::from_str(&body)
        .with_context(|| format!("Failed to parse Cloudflare API JSON response for POST {url}"))?;

    if !envelope.success {
        return Err(anyhow::anyhow!(
            "Cloudflare API POST {url} reported failure: {}",
            cloudflare_api_error_message(&envelope)
        ));
    }

    Ok(envelope)
}

async fn cloudflare_get_bytes(url: Url, api_token: &str) -> anyhow::Result<Vec<u8>> {
    let client = cloudflare_client()?;
    let response = client
        .get(url.clone())
        .bearer_auth(api_token)
        .send()
        .await
        .with_context(|| format!("Cloudflare API request failed: GET {url}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .with_context(|| format!("Failed to read Cloudflare API response: GET {url}"))?;
        return Err(anyhow::anyhow!(
            "Cloudflare API request failed ({status}) for GET {url}: {body}"
        ));
    }

    let bytes = response
        .bytes()
        .await
        .with_context(|| format!("Failed to read Cloudflare API bytes response: GET {url}"))?;
    Ok(bytes.to_vec())
}

fn cloudflare_api_base_url() -> anyhow::Result<Url> {
    Url::parse("https://api.cloudflare.com/client/v4")
        .context("Failed to parse Cloudflare API base URL")
}

fn build_cloudflare_url(path_segments: &[&str]) -> anyhow::Result<Url> {
    let mut url = cloudflare_api_base_url()?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| anyhow::anyhow!("Failed to build Cloudflare API URL segments"))?;
        for segment in path_segments {
            segments.push(segment);
        }
    }
    Ok(url)
}

async fn list_remote_d1_databases(
    account_id: &str,
    api_token: &str,
    page: u32,
    per_page: u32,
) -> anyhow::Result<RemoteD1DatabasesResult> {
    let mut url = build_cloudflare_url(&["accounts", account_id, "d1", "database"])?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("page", &page.to_string());
        query.append_pair("per_page", &per_page.clamp(1, 100).to_string());
    }

    let envelope: CloudflareEnvelope<Vec<CloudflareD1DatabaseApi>> =
        cloudflare_get_json(url, api_token).await?;

    let has_more = envelope
        .result_info
        .as_ref()
        .and_then(|info| info.total_pages)
        .map(|total_pages| page < total_pages)
        .unwrap_or(false);

    Ok(RemoteD1DatabasesResult {
        databases: envelope
            .result
            .into_iter()
            .map(|database| RemoteD1DatabaseInfo {
                id: database.uuid,
                name: database.name,
                created_at: database.created_at,
            })
            .collect(),
        page,
        has_more,
    })
}

async fn list_remote_kv_namespaces(
    account_id: &str,
    api_token: &str,
    page: u32,
    per_page: u32,
) -> anyhow::Result<RemoteKvNamespacesResult> {
    let mut url = build_cloudflare_url(&["accounts", account_id, "storage", "kv", "namespaces"])?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("page", &page.to_string());
        query.append_pair("per_page", &per_page.clamp(1, 100).to_string());
    }

    let envelope: CloudflareEnvelope<Vec<CloudflareKvNamespaceApi>> =
        cloudflare_get_json(url, api_token).await?;

    let has_more = envelope
        .result_info
        .as_ref()
        .and_then(|info| info.total_pages)
        .map(|total_pages| page < total_pages)
        .unwrap_or(false);

    Ok(RemoteKvNamespacesResult {
        namespaces: envelope
            .result
            .into_iter()
            .map(|namespace| RemoteKvNamespaceInfo {
                id: namespace.id,
                title: namespace.title,
                supports_url_encoding: namespace.supports_url_encoding,
            })
            .collect(),
        page,
        has_more,
    })
}

fn build_cloudflare_kv_operator(
    account_id: &str,
    api_token: &str,
    namespace_id: &str,
) -> anyhow::Result<Operator> {
    let mut builder = services::CloudflareKv::default();
    builder = builder
        .api_token(api_token)
        .account_id(account_id)
        .namespace_id(namespace_id)
        .root("/");
    Ok(Operator::new(builder)?.finish())
}

async fn list_remote_kv_entries(
    account_id: &str,
    api_token: &str,
    namespace_id: &str,
    prefix: Option<&str>,
    cursor: Option<&str>,
    limit: u32,
) -> anyhow::Result<RemoteKvListResult> {
    match list_remote_kv_entries_via_opendal(
        account_id,
        api_token,
        namespace_id,
        prefix,
        cursor,
        limit,
    )
    .await
    {
        Ok(result) => Ok(result),
        Err(opendal_error) => {
            eprintln!(
                "OpenDAL Cloudflare KV list failed; falling back to Cloudflare API: {opendal_error}"
            );
            list_remote_kv_entries_via_api(
                account_id,
                api_token,
                namespace_id,
                prefix,
                cursor,
                limit,
            )
            .await
            .with_context(|| {
                format!(
                    "Cloudflare KV list failed via OpenDAL ({opendal_error}) and API fallback"
                )
            })
        }
    }
}

async fn list_remote_kv_entries_via_opendal(
    account_id: &str,
    api_token: &str,
    namespace_id: &str,
    prefix: Option<&str>,
    cursor: Option<&str>,
    limit: u32,
) -> anyhow::Result<RemoteKvListResult> {
    let op = build_cloudflare_kv_operator(account_id, api_token, namespace_id)?;
    let normalized_prefix = prefix.unwrap_or("").trim_start_matches('/');
    let normalized_cursor = cursor
        .map(|value| value.trim_start_matches('/').to_string())
        .filter(|value| !value.is_empty());
    let page_limit = limit.clamp(1, 1000) as usize;

    let list_path = if normalized_prefix.ends_with('/') && !normalized_prefix.is_empty() {
        format!("/{}", normalized_prefix)
    } else {
        String::from("/")
    };

    let lister = op.list_with(&list_path).recursive(true).await?;
    let mut collected = Vec::with_capacity(page_limit);
    let mut is_truncated = false;

    for item in lister {
        if item.metadata().is_dir() {
            continue;
        }

        let key = item.path().trim_start_matches('/').to_string();
        if key.is_empty() {
            continue;
        }

        if !normalized_prefix.is_empty() && !key.starts_with(normalized_prefix) {
            continue;
        }

        if let Some(cursor_value) = normalized_cursor.as_ref() {
            if key <= *cursor_value {
                continue;
            }
        }

        if collected.len() >= page_limit {
            is_truncated = true;
            break;
        }

        collected.push(RemoteKvEntryInfo {
            key,
            expiration: None,
            metadata: None,
        });
    }

    let prefix_for_listing = if normalized_prefix.is_empty() {
        None
    } else {
        Some(normalized_prefix)
    };
    let (prefixes, entries) = build_prefix_listing(collected, prefix_for_listing, |entry| &entry.key);
    let next_cursor = if is_truncated {
        entries.last().map(|entry| entry.key.clone())
    } else {
        None
    };

    Ok(RemoteKvListResult {
        prefixes: prefixes
            .into_iter()
            .map(|prefix| PrefixInfo { prefix })
            .collect(),
        entries,
        is_truncated,
        cursor: next_cursor,
    })
}

async fn list_remote_kv_entries_via_api(
    account_id: &str,
    api_token: &str,
    namespace_id: &str,
    prefix: Option<&str>,
    cursor: Option<&str>,
    limit: u32,
) -> anyhow::Result<RemoteKvListResult> {
    let normalized_prefix = prefix.unwrap_or("").trim_start_matches('/');
    let normalized_cursor = cursor
        .map(str::trim)
        .map(ToOwned::to_owned)
        .filter(|value| !value.is_empty());
    let page_limit = limit.clamp(10, 1000);

    let mut url = build_cloudflare_url(&[
        "accounts",
        account_id,
        "storage",
        "kv",
        "namespaces",
        namespace_id,
        "keys",
    ])?;

    {
        let mut query = url.query_pairs_mut();
        if !normalized_prefix.is_empty() {
            query.append_pair("prefix", normalized_prefix);
        }
        if let Some(cursor_value) = normalized_cursor.as_deref() {
            query.append_pair("cursor", cursor_value);
        }
        query.append_pair("limit", &page_limit.to_string());
    }

    let envelope: CloudflareEnvelope<Vec<CloudflareKvKeyApi>> =
        cloudflare_get_json(url, api_token).await?;

    let entries = envelope
        .result
        .into_iter()
        .map(|entry| RemoteKvEntryInfo {
            key: entry.name,
            expiration: entry.expiration,
            metadata: entry.metadata.map(|metadata| metadata.to_string()),
        })
        .collect::<Vec<_>>();

    let prefix_for_listing = if normalized_prefix.is_empty() {
        None
    } else {
        Some(normalized_prefix)
    };
    let (prefixes, entries) = build_prefix_listing(entries, prefix_for_listing, |entry| &entry.key);

    let next_cursor = envelope
        .result_info
        .and_then(|info| info.cursor)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let is_truncated = next_cursor.is_some();

    Ok(RemoteKvListResult {
        prefixes: prefixes
            .into_iter()
            .map(|prefix_value| PrefixInfo {
                prefix: prefix_value,
            })
            .collect(),
        entries,
        cursor: next_cursor,
        is_truncated,
    })
}

async fn read_remote_kv_value(
    account_id: &str,
    api_token: &str,
    namespace_id: &str,
    key: &str,
) -> anyhow::Result<RemoteKvValueResult> {
    let normalized_key = key.trim_start_matches('/');
    let bytes = match read_remote_kv_value_via_opendal(
        account_id,
        api_token,
        namespace_id,
        normalized_key,
    )
    .await
    {
        Ok(value) => value,
        Err(opendal_error) => {
            eprintln!(
                "OpenDAL Cloudflare KV read failed; falling back to Cloudflare API: {opendal_error}"
            );
            read_remote_kv_value_via_api(account_id, api_token, namespace_id, normalized_key)
                .await
                .with_context(|| {
                    format!(
                        "Cloudflare KV read failed via OpenDAL ({opendal_error}) and API fallback"
                    )
                })?
        }
    };
    let content = String::from_utf8_lossy(&bytes).to_string();

    Ok(RemoteKvValueResult { content })
}

async fn read_remote_kv_value_via_opendal(
    account_id: &str,
    api_token: &str,
    namespace_id: &str,
    key: &str,
) -> anyhow::Result<Vec<u8>> {
    let op = build_cloudflare_kv_operator(account_id, api_token, namespace_id)?;
    let buffer = op
        .read(key)
        .await
        .with_context(|| format!("Failed to read Cloudflare KV key: {key}"))?;
    Ok(buffer.to_vec())
}

async fn read_remote_kv_value_via_api(
    account_id: &str,
    api_token: &str,
    namespace_id: &str,
    key: &str,
) -> anyhow::Result<Vec<u8>> {
    let url = build_cloudflare_url(&[
        "accounts",
        account_id,
        "storage",
        "kv",
        "namespaces",
        namespace_id,
        "values",
        key,
    ])?;
    cloudflare_get_bytes(url, api_token).await
}

async fn query_remote_d1(
    account_id: &str,
    api_token: &str,
    database_id: &str,
    sql: &str,
) -> anyhow::Result<Vec<JsonMap<String, JsonValue>>> {
    let url = build_cloudflare_url(&[
        "accounts",
        account_id,
        "d1",
        "database",
        database_id,
        "query",
    ])?;

    let payload = serde_json::json!({ "sql": sql });
    let envelope: CloudflareEnvelope<Vec<CloudflareD1QueryResultApi>> =
        cloudflare_post_json(url, api_token, &payload).await?;

    Ok(envelope
        .result
        .into_iter()
        .next()
        .map(|result| result.results)
        .unwrap_or_default())
}

fn sanitize_snapshot_file_part(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            output.push(ch);
        } else {
            output.push('_');
        }
    }
    if output.is_empty() {
        return String::from("remote-d1");
    }
    output
}

fn remote_d1_snapshot_path(database_id: &str) -> anyhow::Result<PathBuf> {
    let root = std::env::temp_dir()
        .join("cloudflare-bindings-explorer")
        .join("remote-d1");
    fs::create_dir_all(&root).context("Failed to create remote D1 snapshot directory")?;
    Ok(root.join(format!(
        "{}.sqlite",
        sanitize_snapshot_file_part(database_id)
    )))
}

fn remote_d1_temp_snapshot_path(database_id: &str) -> anyhow::Result<PathBuf> {
    let root = std::env::temp_dir()
        .join("cloudflare-bindings-explorer")
        .join("remote-d1");
    fs::create_dir_all(&root).context("Failed to create remote D1 snapshot directory")?;
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    Ok(root.join(format!(
        "{}.{suffix}.tmp.sqlite",
        sanitize_snapshot_file_part(database_id)
    )))
}

fn snapshot_is_fresh(path: &Path, max_age: Duration) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };

    let Ok(modified) = metadata.modified() else {
        return false;
    };

    let Ok(elapsed) = SystemTime::now().duration_since(modified) else {
        return false;
    };

    elapsed <= max_age
}

fn bind_json_value_to_query<'q>(
    query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    value: &JsonValue,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match value {
        JsonValue::Null => query.bind(Option::<String>::None),
        JsonValue::Bool(value) => query.bind(if *value { 1_i64 } else { 0_i64 }),
        JsonValue::Number(value) => {
            if let Some(number) = value.as_i64() {
                return query.bind(number);
            }
            if let Some(number) = value.as_u64() {
                if number <= i64::MAX as u64 {
                    return query.bind(number as i64);
                }
                return query.bind(number.to_string());
            }
            if let Some(number) = value.as_f64() {
                return query.bind(number);
            }
            query.bind(value.to_string())
        }
        JsonValue::String(value) => query.bind(value.clone()),
        JsonValue::Array(_) | JsonValue::Object(_) => query.bind(value.to_string()),
    }
}

async fn insert_remote_rows_into_snapshot(
    conn: &mut SqliteConnection,
    table: &str,
    rows: &[JsonMap<String, JsonValue>],
) -> anyhow::Result<()> {
    let quoted_table = quote_identifier(table);
    for row in rows {
        if row.is_empty() {
            continue;
        }

        let columns = row.keys().cloned().collect::<Vec<_>>();
        if columns.is_empty() {
            continue;
        }

        let quoted_columns = columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        let placeholders = std::iter::repeat("?")
            .take(columns.len())
            .collect::<Vec<_>>()
            .join(", ");
        let insert_sql =
            format!("INSERT INTO {quoted_table} ({quoted_columns}) VALUES ({placeholders})");

        let mut query = sqlx::query(&insert_sql);
        for column in &columns {
            let value = row.get(column).unwrap_or(&JsonValue::Null);
            query = bind_json_value_to_query(query, value);
        }

        // Best effort: if a row fails due to constraints/schema mismatch, continue.
        let _ = query.execute(&mut *conn).await;
    }

    Ok(())
}

async fn materialize_remote_d1_database(
    account_id: &str,
    api_token: &str,
    database_id: &str,
    database_name: Option<&str>,
    force_refresh: bool,
    max_tables: usize,
    max_rows_per_table: usize,
) -> anyhow::Result<RemoteD1SnapshotResult> {
    let max_tables = max_tables.clamp(1, 500);
    let max_rows_per_table = max_rows_per_table.clamp(1, 2000);
    let resolved_database_name = database_name.unwrap_or(database_id).to_string();
    let snapshot_path = remote_d1_snapshot_path(database_id)?;

    if !force_refresh && snapshot_is_fresh(&snapshot_path, Duration::from_secs(120)) {
        return Ok(RemoteD1SnapshotResult {
            sqlite_path: snapshot_path.to_string_lossy().to_string(),
            from_cache: true,
            table_count: 0,
            row_limit: max_rows_per_table,
            database_id: database_id.to_string(),
            database_name: resolved_database_name,
        });
    }

    let temp_snapshot_path = remote_d1_temp_snapshot_path(database_id)?;
    if temp_snapshot_path.exists() {
        let _ = fs::remove_file(&temp_snapshot_path);
    }

    let temp_snapshot_path_str = temp_snapshot_path.to_string_lossy().to_string();

    let materialize_result = async {
        let mut conn = connect_sqlite_with_create(&temp_snapshot_path_str, true).await?;

        // Keep the snapshot compatible with sql.js direct file reads.
        let _ = sqlx::query("PRAGMA journal_mode = DELETE")
            .execute(&mut conn)
            .await;
        let _ = sqlx::query("PRAGMA synchronous = FULL")
            .execute(&mut conn)
            .await;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS __cbe_remote_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        )
        .execute(&mut conn)
        .await
        .context("Failed to create remote D1 metadata table")?;

        let now = chrono_like_timestamp();
        sqlx::query("INSERT OR REPLACE INTO __cbe_remote_metadata (key, value) VALUES ('database_id', ?), ('database_name', ?), ('fetched_at', ?)")
            .bind(database_id)
            .bind(&resolved_database_name)
            .bind(now)
            .execute(&mut conn)
            .await
            .context("Failed to write remote D1 metadata")?;

        let table_query = format!(
            "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT {}",
            max_tables
        );
        let table_rows = query_remote_d1(account_id, api_token, database_id, &table_query).await?;

        let mut materialized_tables = 0usize;

        for table_row in table_rows {
            let Some(table_name) = table_row
                .get("name")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned)
            else {
                continue;
            };

            let create_statement = table_row
                .get("sql")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned);

            if let Some(create_statement) = create_statement {
                if create_statement.trim().is_empty() {
                    continue;
                }
                // Best effort: if schema creation fails for a table, skip it.
                if sqlx::query(&create_statement)
                    .execute(&mut conn)
                    .await
                    .is_err()
                {
                    continue;
                }
            } else {
                continue;
            }

            let select_query = format!(
                "SELECT * FROM {} LIMIT {}",
                quote_identifier(&table_name),
                max_rows_per_table
            );
            let rows = query_remote_d1(account_id, api_token, database_id, &select_query)
                .await
                .unwrap_or_default();
            insert_remote_rows_into_snapshot(&mut conn, &table_name, &rows).await?;
            materialized_tables += 1;
        }

        conn.close()
            .await
            .context("Failed to finalize remote D1 snapshot connection")?;

        Ok::<usize, anyhow::Error>(materialized_tables)
    }
    .await;

    let materialized_tables = match materialize_result {
        Ok(count) => count,
        Err(error) => {
            let _ = fs::remove_file(&temp_snapshot_path);
            return Err(error);
        }
    };

    if let Err(first_error) = fs::rename(&temp_snapshot_path, &snapshot_path) {
        if snapshot_path.exists() {
            let _ = fs::remove_file(&snapshot_path);
        }

        if let Err(second_error) = fs::rename(&temp_snapshot_path, &snapshot_path) {
            let _ = fs::remove_file(&temp_snapshot_path);
            return Err(anyhow::anyhow!(
                "Failed to replace remote D1 snapshot file at {}: initial rename error: {first_error}; retry error: {second_error}",
                snapshot_path.to_string_lossy()
            ));
        }
    }

    Ok(RemoteD1SnapshotResult {
        sqlite_path: snapshot_path.to_string_lossy().to_string(),
        from_cache: false,
        table_count: materialized_tables,
        row_limit: max_rows_per_table,
        database_id: database_id.to_string(),
        database_name: resolved_database_name,
    })
}

fn chrono_like_timestamp() -> String {
    let now = SystemTime::now();
    let unix = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    unix.to_string()
}

#[cfg(test)]
mod tests {
    use super::{list_storage_types, list_wrangler_roots};
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new() -> Self {
            let path = PathBuf::from(new_temp_root());
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn new_temp_root() -> String {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("bindings-cli-test-{nonce}"));
        fs::create_dir_all(&path).expect("failed to create temp directory");
        path.to_string_lossy().to_string()
    }

    fn create_dir(path: &Path, relative: &str) {
        fs::create_dir_all(path.join(relative)).expect("failed to create test directory");
    }

    fn create_file(path: &Path, relative: &str, content: &str) {
        let file_path = path.join(relative);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("failed to create parent directories");
        }
        fs::write(file_path, content).expect("failed to write test file");
    }

    #[test]
    fn list_wrangler_roots_only_includes_candidates_with_storage_files() {
        let root = TempDirGuard::new();
        let root_path = root.path();

        create_dir(root_path, ".wrangler");
        create_file(
            root_path,
            ".wrangler-state/state/v3/r2/demo-bucket/blobs/blob.bin",
            "r2-data",
        );
        create_file(
            root_path,
            "wrangler/state/v3/d1/miniflare-D1DatabaseObject/demo.sqlite",
            "d1-data",
        );
        create_dir(
            root_path,
            "wrangler-dirs-only/state/v3/d1/miniflare-D1DatabaseObject",
        );
        create_dir(root_path, "wrangler-cache");
        create_dir(root_path, "something-else");

        let found = list_wrangler_roots(&[root_path.to_string_lossy().to_string()]);
        let found_set = found.into_iter().collect::<BTreeSet<_>>();

        assert!(
            found_set.contains(
                &root_path
                    .join(".wrangler-state")
                    .to_string_lossy()
                    .to_string()
            )
        );
        assert!(found_set.contains(&root_path.join("wrangler").to_string_lossy().to_string()));
        assert!(!found_set.contains(&root_path.join(".wrangler").to_string_lossy().to_string()));
        assert!(
            !found_set.contains(
                &root_path
                    .join("wrangler-cache")
                    .to_string_lossy()
                    .to_string()
            )
        );
        assert!(
            !found_set.contains(
                &root_path
                    .join("wrangler-dirs-only")
                    .to_string_lossy()
                    .to_string()
            )
        );
        assert!(
            !found_set.contains(
                &root_path
                    .join("something-else")
                    .to_string_lossy()
                    .to_string()
            )
        );
    }

    #[test]
    fn list_wrangler_roots_skips_node_modules_candidates() {
        let root = TempDirGuard::new();
        let root_path = root.path();

        create_file(
            root_path,
            ".wrangler-state/state/v3/kv/demo-namespace/blobs/blob.bin",
            "kv-data",
        );
        create_file(
            root_path,
            "node_modules/dependency/.wrangler-local/state/v3/r2/demo-bucket/blobs/blob.bin",
            "ignored-r2-data",
        );

        let found = list_wrangler_roots(&[root_path.to_string_lossy().to_string()]);
        let found_set = found.into_iter().collect::<BTreeSet<_>>();

        assert!(
            found_set.contains(
                &root_path
                    .join(".wrangler-state")
                    .to_string_lossy()
                    .to_string()
            )
        );
        assert!(
            !found_set.contains(
                &root_path
                    .join("node_modules")
                    .join("dependency")
                    .join(".wrangler-local")
                    .to_string_lossy()
                    .to_string()
            )
        );
    }

    #[test]
    fn list_storage_types_requires_real_files_per_storage_type() {
        let root = TempDirGuard::new();
        let root_path = root.path();
        let wrangler_root = root_path.join(".wrangler-state");

        create_dir(
            root_path,
            ".wrangler-state/state/v3/kv/demo-namespace/blobs",
        );
        create_dir(
            root_path,
            ".wrangler-state/state/v3/d1/miniflare-D1DatabaseObject",
        );
        create_dir(root_path, ".wrangler-state/state/v3/r2/demo-bucket/blobs");

        let empty_result = list_storage_types(wrangler_root.to_string_lossy().as_ref());
        assert!(empty_result.types.is_empty());

        create_file(
            root_path,
            ".wrangler-state/state/v3/kv/demo-namespace/blobs/kv.bin",
            "kv-data",
        );
        let kv_only_result = list_storage_types(wrangler_root.to_string_lossy().as_ref());
        assert_eq!(kv_only_result.types, vec!["kv".to_string()]);

        create_file(
            root_path,
            ".wrangler-state/state/v3/d1/miniflare-D1DatabaseObject/demo.sqlite",
            "d1-data",
        );
        create_file(
            root_path,
            ".wrangler-state/state/v3/r2/demo-bucket/blobs/blob.bin",
            "r2-data",
        );
        let full_result = list_storage_types(wrangler_root.to_string_lossy().as_ref());
        assert_eq!(
            full_result.types,
            vec!["kv".to_string(), "d1".to_string(), "r2".to_string()]
        );
    }
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
