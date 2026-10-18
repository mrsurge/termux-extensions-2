//! MCP projections of the existing native manager; never constructs a manager.
use ferrous_framework::{FerrousNativeManager, FerrousNativeShellRecord, FerrousNativeShellStatus};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LogInput {
    shell_id: String,
    #[serde(default = "both")]
    stream: String,
    #[serde(default = "lines")]
    lines: i64,
    #[serde(default = "limit")]
    limit: i64,
    #[serde(default)]
    query: String,
    #[serde(default)]
    regex: bool,
    #[serde(default)]
    ignore_case: bool,
    #[serde(default)]
    format: String,
    #[serde(default)]
    signature: String,
    #[serde(default)]
    exclude_query: String,
    #[serde(default)]
    exclude_signature: String,
    #[serde(default)]
    include_io_metadata: bool,
    #[serde(default)]
    include_stdin: bool,
    #[serde(default)]
    include_timestamps: bool,
    #[serde(default)]
    include_output_metadata: bool,
}
fn both() -> String {
    "both".into()
}
fn lines() -> i64 {
    200
}
fn limit() -> i64 {
    100
}

pub(crate) fn parse_log(name: &str, args: Value) -> Result<(String, String, Value), String> {
    let object = args.as_object().ok_or("Log arguments must be an object")?;
    let allowed: &[&str] = match name {
        "te2_fws_log_tail" => &["shell_id", "stream", "lines"],
        "te2_fws_log_search" => &[
            "shell_id",
            "stream",
            "query",
            "limit",
            "regex",
            "ignore_case",
        ],
        _ => &[
            "shell_id",
            "stream",
            "query",
            "lines",
            "limit",
            "regex",
            "ignore_case",
            "format",
            "signature",
            "exclude_query",
            "exclude_signature",
            "include_io_metadata",
            "include_stdin",
            "include_timestamps",
            "include_output_metadata",
        ],
    };
    if object.keys().any(|key| !allowed.contains(&key.as_str()))
        || (name == "te2_fws_log_search" && !object.contains_key("query"))
    {
        return Err("Invalid log tool arguments".into());
    }
    let input: LogInput = serde_json::from_value(args).map_err(|e| e.to_string())?;
    let stream = if input.stream.trim().is_empty() {
        "both".into()
    } else {
        input.stream.trim().to_lowercase()
    };
    if !matches!(stream.as_str(), "stdout" | "stderr" | "both") {
        return Err("Invalid log stream".into());
    }
    let shell_id = input.shell_id.clone();
    let mut options = serde_json::to_value(input).map_err(|e| e.to_string())?;
    options.as_object_mut().unwrap().remove("shell_id");
    options["stream"] = json!(stream);
    let operation = match name {
        "te2_fws_log_tail" => "tail",
        "te2_fws_log_search" => "search",
        _ => "inspect",
    };
    Ok((shell_id, operation.into(), options))
}

pub(crate) enum FwsCall {
    Running,
    Log {
        shell_id: String,
        operation: String,
        options: Value,
    },
    Get {
        shell_id: String,
    },
    Write {
        shell_id: String,
        data: String,
        append_newline: bool,
        eof: bool,
    },
}

fn alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    (unsafe { libc::kill(pid as i32, 0) == 0 })
        || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

fn payload(record: FerrousNativeShellRecord, run_id: &str) -> Value {
    use std::io::Read;
    // Python's compatibility payload includes launcher PID. It is observational
    // metadata only, never a substitute for the manager's live input capability.
    let launcher_pid = std::fs::File::open(&record.record_path)
        .ok()
        .and_then(|file| {
            let mut bytes = Vec::new();
            file.take(1024 * 1024).read_to_end(&mut bytes).ok()?;
            let metadata: Value = serde_json::from_slice(&bytes).ok()?;
            metadata["launcher_pid"].as_i64()
        });
    let backend = &record.backend;
    // Environment values are private. Publish names only, as Python did.
    json!({"id":record.id,"spec_id":record.spec_id,"command":record.command,"cwd":record.cwd,"pid":record.pid,
        "status":record.status,"exit_code":record.exit_code,"label":record.label,"subgroups":record.subgroups,
        "stdout_log":record.stdout_log,"stderr_log":record.stderr_log,"io_metadata_log":record.io_metadata_log,
        "pty_mode":record.pty_mode.map(|m|serde_json::to_value(m).unwrap()).unwrap_or(json!("raw")),
        "autostart":record.autostart,"ui":record.ui,"debug":record.debug,"log_codecs":record.log_codecs,
        "runtime_id":record.runtime_id,"app_id":record.app_id,"parent_shell_id":record.parent_shell_id,
        "is_app_worker":record.is_app_worker,"adopted":record.adopted,"created_at":record.created_at_ms as f64/1000.0,
        "updated_at":record.updated_at_ms as f64/1000.0,"env_keys":record.env_keys,"run_id":run_id,
        "backend":backend,"uses_pty":backend=="pty","uses_pipes":backend=="pipe","uses_dtach":false,"launcher_pid":launcher_pid})
}

pub(crate) fn dispatch(manager: &FerrousNativeManager, call: FwsCall) -> Result<Value, String> {
    let source = "framework_shells.direct";
    Ok(match call {
        FwsCall::Log { .. } => return Err("Log requests require the projection service".into()),
        FwsCall::Running => {
            let records = manager.list_shells().map_err(|e| e.to_string())?;
            let run_id = manager.native_env().run_id;
            json!({"ok":true,"data":records.into_iter().filter(|r|r.status==FerrousNativeShellStatus::Running && alive(r.pid)).map(|r|payload(r,&run_id)).collect::<Vec<_>>(),"source":source})
        }
        FwsCall::Get { shell_id } => match manager
            .get_shell(shell_id.trim())
            .map_err(|e| e.to_string())?
        {
            Some(record) => {
                json!({"ok":true,"data":payload(record,&manager.native_env().run_id),"source":source})
            }
            None => json!({"ok":false,"error":format!("Shell not found: {shell_id}")}),
        },
        FwsCall::Write {
            shell_id,
            data,
            append_newline,
            eof,
        } => {
            let id = shell_id.trim();
            if id.is_empty() {
                return Ok(json!({"ok":false,"error":"shell_id is required","source":source}));
            }
            if eof && !data.is_empty() {
                return Ok(
                    json!({"ok":false,"error":"Provide either data or eof=true, not both","source":source}),
                );
            }
            // Exactly one owner submission, never an HTTP fallback/retry.
            let result = if eof {
                manager.send_shell_eof_blocking(id)
            } else {
                manager.write_to_shell_blocking(id, &data, append_newline)
            };
            match result {
                Ok(result) => json!({"ok":true,"data":result,"source":source}),
                Err(e) => json!({"ok":false,"error":e.to_string(),"source":source}),
            }
        }
    })
}

pub(crate) fn prepare_log_request(
    manager: &FerrousNativeManager,
    shell_id: &str,
    operation: String,
    options: Value,
) -> Result<Value, String> {
    let record = manager
        .get_shell(shell_id.trim())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Shell not found: {shell_id}"))?;
    Ok(json!({"operation":operation,"options":options,"snapshot":{
        "shell_id":shell_id.trim(),"status":record.status,"created_at":record.created_at_ms as f64/1000.0,
        "updated_at":record.updated_at_ms as f64/1000.0,"stdout_log":record.stdout_log,"stderr_log":record.stderr_log,
        "io_metadata_log":record.io_metadata_log,"log_codecs":record.log_codecs
    }}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn process_probe_matches_running_admission() {
        assert!(!alive(0));
        assert!(!alive(u32::MAX));
        assert!(alive(std::process::id()));
    }

    #[test]
    fn shell_projection_keeps_compatibility_fields_without_environment_values() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("fixture.json");
        std::fs::write(&path,json!({"id":"fixture","backend":"pipe","command":["fixture"],"pid":std::process::id(),"status":"running",
            "spec_id":"fixture","label":"fixture","stdout_log":root.path().join("stdout"),"stderr_log":root.path().join("stderr"),
            "env":{"PRIVATE_KEY":"do-not-return"},"env_keys":["PRIVATE_KEY"],"launcher_pid":123,"created_at":1.0,"updated_at":2.0}).to_string()).unwrap();
        let record = ferrous_framework::load_persisted_record(&path).unwrap();
        let value = payload(record, "fixture-run");
        assert_eq!(value["launcher_pid"], 123);
        assert_eq!(value["uses_pipes"], true);
        assert!(value.get("env").is_none());
        assert!(value.get("env_overrides").is_none());
        assert!(!value.to_string().contains("do-not-return"));
    }
}
