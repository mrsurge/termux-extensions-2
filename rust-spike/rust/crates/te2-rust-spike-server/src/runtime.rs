use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize)]
pub struct RunningApp {
    pub app_id: String,
    pub port: u16,
    pub shell_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub source: &'static str,
    pub created_at: f64,
    pub updated_at: f64,
    pub locked: bool,
    pub uptime: f64,
    pub cpu: f64,
    pub ram: u64,
    pub readiness: Map<String, Value>,
}

#[derive(Clone, Debug)]
pub struct FwsDiscovery {
    base_dir: PathBuf,
    fingerprint: Option<String>,
}

impl FwsDiscovery {
    pub fn from_env() -> Self {
        let base_dir = env::var_os("FRAMEWORK_SHELLS_BASE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join(".cache").join("framework_shells"));
        let fingerprint = env::var("FRAMEWORK_SHELLS_REPO_FINGERPRINT")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        Self {
            base_dir,
            fingerprint,
        }
    }

    pub fn list_running_apps(&self) -> Vec<RunningApp> {
        let mut by_app: HashMap<String, RunningApp> = HashMap::new();

        // FWS metadata is the app-worker discovery boundary for this spike. This
        // stays read-only here; launch/adoption semantics remain a later phase.
        for meta_path in self.metadata_paths() {
            let Some(record) = load_record(&meta_path) else {
                continue;
            };
            let Some(app) = running_app_from_record(&record) else {
                continue;
            };
            match by_app.get(&app.app_id) {
                Some(existing) if record_sort_key(existing) >= record_sort_key(&app) => {}
                _ => {
                    by_app.insert(app.app_id.clone(), app);
                }
            }
        }

        let mut apps = by_app.into_values().collect::<Vec<_>>();
        apps.sort_by(|a, b| {
            a.created_at
                .partial_cmp(&b.created_at)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.app_id.cmp(&b.app_id))
        });
        apps
    }

    fn metadata_paths(&self) -> Vec<PathBuf> {
        let runtimes_root = self.base_dir.join("runtimes");
        let fingerprint_dirs = match &self.fingerprint {
            Some(fingerprint) => vec![runtimes_root.join(fingerprint)],
            None => sorted_dirs(&runtimes_root),
        };

        let mut paths = Vec::new();
        for fingerprint_dir in fingerprint_dirs {
            for runtime_dir in sorted_dirs(&fingerprint_dir) {
                let meta_dir = runtime_dir.join("meta");
                for shell_dir in sorted_dirs(&meta_dir) {
                    let meta = shell_dir.join("meta.json");
                    if meta.is_file() {
                        paths.push(meta);
                    }
                }
            }
        }
        paths.sort();
        paths
    }
}

fn load_record(path: &Path) -> Option<Map<String, Value>> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&text)
        .ok()?
        .as_object()
        .cloned()
}

fn running_app_from_record(record: &Map<String, Value>) -> Option<RunningApp> {
    if string_field(record, "status").as_deref() != Some("running") {
        return None;
    }
    if !is_app_worker_record(record) {
        return None;
    }
    let pid = i64_field(record, "pid")?;
    if !process_is_alive(pid) {
        return None;
    }
    let app_id = derive_app_id(record)?;
    let port = app_worker_port(record)?;
    let created_at = f64_field(record, "created_at").unwrap_or_default();
    let updated_at = f64_field(record, "updated_at").unwrap_or(created_at);
    let now = now_seconds();

    Some(RunningApp {
        app_id,
        port,
        shell_id: string_field(record, "id")?,
        label: string_field(record, "label"),
        source: "framework_shells",
        created_at,
        updated_at,
        locked: false,
        uptime: if created_at > 0.0 {
            (now - created_at).max(0.0)
        } else {
            0.0
        },
        cpu: 0.0,
        ram: 0,
        readiness: Map::new(),
    })
}

fn derive_app_id(record: &Map<String, Value>) -> Option<String> {
    let label = string_field(record, "label").unwrap_or_default();
    if let Some(app_id) = label.strip_prefix("app-worker:") {
        let app_id = app_id.trim();
        if !app_id.is_empty() {
            return Some(app_id.to_owned());
        }
    }
    if let Some(app_id) = string_field(record, "app_id").filter(|value| !value.is_empty()) {
        return Some(app_id);
    }
    let subgroups = record.get("subgroups")?.as_array()?;
    subgroups
        .first()
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn is_app_worker_record(record: &Map<String, Value>) -> bool {
    if record
        .get("is_app_worker")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }
    if string_field(record, "label")
        .as_deref()
        .is_some_and(|label| label.starts_with("app-worker:"))
    {
        return true;
    }
    let Some(subgroups) = record.get("subgroups").and_then(Value::as_array) else {
        return false;
    };
    subgroups
        .get(1)
        .and_then(Value::as_str)
        .is_some_and(|value| value.trim() == "app-worker")
}

fn app_worker_port(record: &Map<String, Value>) -> Option<u16> {
    let env_overrides = record.get("env_overrides")?.as_object()?;
    match env_overrides.get("TE_APP_WORKER_PORT")? {
        Value::Number(number) => number.as_u64().and_then(|value| u16::try_from(value).ok()),
        Value::String(value) => value.trim().parse::<u16>().ok(),
        _ => None,
    }
}

fn record_sort_key(app: &RunningApp) -> (u64, u64, String) {
    (
        (app.updated_at.max(0.0) * 1000.0) as u64,
        (app.created_at.max(0.0) * 1000.0) as u64,
        app.shell_id.clone(),
    )
}

fn sorted_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = match fs::read_dir(root) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>(),
        Err(_) => Vec::new(),
    };
    dirs.sort();
    dirs
}

fn string_field(record: &Map<String, Value>, key: &str) -> Option<String> {
    record
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn i64_field(record: &Map<String, Value>, key: &str) -> Option<i64> {
    match record.get(key)? {
        Value::Number(number) => number.as_i64(),
        Value::String(value) => value.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn f64_field(record: &Map<String, Value>, key: &str) -> Option<f64> {
    match record.get(key)? {
        Value::Number(number) => number.as_f64(),
        Value::String(value) => value.trim().parse::<f64>().ok(),
        _ => None,
    }
}

#[cfg(target_family = "unix")]
fn process_is_alive(pid: i64) -> bool {
    if pid <= 0 {
        return false;
    }
    let stat = match fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => stat,
        Err(_) => return false,
    };
    let Some((_, after_name)) = stat.rsplit_once(") ") else {
        return false;
    };
    !matches!(after_name.split_whitespace().next(), Some("Z" | "X") | None)
}

#[cfg(not(target_family = "unix"))]
fn process_is_alive(pid: i64) -> bool {
    pid > 0
}

fn now_seconds() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64())
        .unwrap_or_default()
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
