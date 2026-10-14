//! Read-only persisted console projection; never imports or resets the live relay.
use serde_json::{Value, json, value::RawValue};
use std::{
    collections::BTreeSet,
    fs::File,
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom},
    path::Path,
};

const CHUNK: usize = 64 * 1024;
const MAX_RECORD: usize = 8 * 1024 * 1024;

fn integer_string(raw: &str) -> Option<Value> {
    let raw = raw.trim();
    let bytes = raw.as_bytes();
    for (i, byte) in bytes.iter().enumerate() {
        if *byte == b'_'
            && (i == 0
                || i + 1 == bytes.len()
                || !bytes[i - 1].is_ascii_digit()
                || !bytes[i + 1].is_ascii_digit())
        {
            return None;
        }
    }
    let clean = raw.replace('_', "");
    let integer = if let Some((integer, fraction)) = clean.split_once('.') {
        if fraction.is_empty() || !fraction.bytes().all(|b| b == b'0') {
            return None;
        }
        integer
    } else {
        &clean
    };
    let digits = integer.strip_prefix(['+', '-']).unwrap_or(integer);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    integer
        .parse::<i64>()
        .map(|n| json!(n))
        .ok()
        .or_else(|| integer.parse::<u64>().map(|n| json!(n)).ok())
}

// Match ConsoleLogEntry defaults, ignored extra fields and integer coercion.
fn entry(raw: &[u8]) -> Option<Value> {
    let value: Value = serde_json::from_slice(raw).ok()?;
    let object = value.as_object()?;
    let worker = match object.get("workerId") {
        Some(v) => v.as_str()?,
        None => "",
    };
    let level = match object.get("level") {
        Some(v) => v.as_str()?,
        None => "log",
    };
    let args = match object.get("args") {
        Some(v) => v.as_array()?.clone(),
        None => Vec::new(),
    };
    let ts = match object.get("ts") {
        None | Some(Value::Null) => Value::Null,
        Some(Value::Bool(v)) => json!(i64::from(*v)),
        Some(Value::String(v)) => integer_string(v)?,
        Some(v) => {
            if let Some(n) = v.as_i64() {
                json!(n)
            } else if let Some(n) = v.as_u64() {
                json!(n)
            } else {
                let n = v.as_f64()?;
                if n.fract() != 0.0 || n < i64::MIN as f64 || n >= i64::MAX as f64 {
                    return None;
                }
                json!(n as i64)
            }
        }
    };
    Some(json!({"workerId":worker,"level":level,"ts":ts,"args":args}))
}

fn matches(value: &Value, worker: Option<&str>, level: Option<&str>) -> bool {
    worker.is_none_or(|w| w.is_empty() || value["workerId"] == w)
        && level.is_none_or(|l| l.is_empty() || value["level"] == l)
}

// Retain object order inside arguments, without changing serde_json map policy
// across the framework. Input has already passed JSON/model validation.
fn search_json(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut output = String::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => {
                let start = i;
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\\' {
                        i += 2;
                    } else if bytes[i] == b'"' {
                        i += 1;
                        break;
                    } else {
                        i += 1;
                    }
                }
                let string: String = serde_json::from_str(&raw[start..i]).unwrap();
                output.push_str(&serde_json::to_string(&string).unwrap());
            }
            b',' => {
                output.push_str(", ");
                i += 1;
            }
            b':' => {
                output.push_str(": ");
                i += 1;
            }
            b'{' | b'}' | b'[' | b']' => {
                output.push(bytes[i] as char);
                i += 1;
            }
            b' ' | b'\n' | b'\r' | b'\t' => {
                i += 1;
            }
            _ => {
                let start = i;
                while i < bytes.len()
                    && !matches!(bytes[i], b',' | b'}' | b']' | b' ' | b'\n' | b'\r' | b'\t')
                {
                    i += 1;
                }
                let value: Value = serde_json::from_str(&raw[start..i]).unwrap();
                if let Value::Number(number) = &value
                    && number.is_f64()
                {
                    // Match Python's scientific threshold and padded exponent.
                    let value = number.as_f64().unwrap();
                    let scientific = format!("{value:e}");
                    let (mantissa, exponent) = scientific.split_once('e').unwrap();
                    let exponent: i32 = exponent.parse().unwrap();
                    if !(-4..16).contains(&exponent) {
                        output.push_str(&format!("{mantissa}e{exponent:+03}"));
                    } else {
                        let decimal = value.to_string();
                        output.push_str(&decimal);
                        if !decimal.contains('.') {
                            output.push_str(".0");
                        }
                    }
                } else {
                    output.push_str(&serde_json::to_string(&value).unwrap());
                }
            }
        }
    }
    output
}

fn text(value: &Value, raw: &[u8]) -> String {
    let mut parts = vec![
        value["workerId"].as_str().unwrap().to_owned(),
        value["level"].as_str().unwrap().to_owned(),
    ];
    let object: std::collections::HashMap<String, Box<RawValue>> =
        serde_json::from_slice(raw).unwrap();
    let args: Vec<Box<RawValue>> = object
        .get("args")
        .map(|args| serde_json::from_str(args.get()).unwrap())
        .unwrap_or_default();
    parts.extend(args.iter().map(|arg| search_json(arg.get())));
    parts.join(" ").to_lowercase()
}

fn open(path: &Path) -> io::Result<Option<File>> {
    match File::open(path) {
        Ok(file) => Ok(Some(file)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

// Stream forward without allowing a corrupt record to allocate an entire file.
fn forward(path: &Path, mut visit: impl FnMut(Value, &[u8]) -> bool) -> io::Result<()> {
    let Some(file) = open(path)? else {
        return Ok(());
    };
    let mut reader = BufReader::with_capacity(CHUNK, file);
    let mut record = Vec::new();
    let mut oversized = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            if !oversized && !record.is_empty() {
                std::str::from_utf8(&record)
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
                if let Some(value) = entry(&record) {
                    visit(value, &record);
                }
            }
            return Ok(());
        }
        let newline = available.iter().position(|b| *b == b'\n');
        let take = newline.map_or(available.len(), |n| n + 1);
        if !oversized {
            let body = &available[..newline.unwrap_or(take)];
            if record.len() + body.len() <= MAX_RECORD {
                record.extend_from_slice(body);
            } else {
                record.clear();
                oversized = true;
            }
        }
        reader.consume(take);
        if newline.is_some() {
            if !oversized {
                std::str::from_utf8(&record)
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
                if let Some(value) = entry(&record) {
                    if !visit(value, &record) {
                        return Ok(());
                    }
                }
            }
            record.clear();
            oversized = false;
        }
    }
}

pub(crate) fn workers(path: &Path) -> io::Result<Value> {
    let mut workers = BTreeSet::new();
    forward(path, |entry, _| {
        let worker = entry["workerId"].as_str().unwrap();
        if !worker.is_empty() {
            workers.insert(worker.to_owned());
        }
        true
    })?;
    Ok(json!({"workers":workers,"source":"console_log_jsonl","log_path":path}))
}

pub(crate) fn search(
    path: &Path,
    query: &str,
    limit: i64,
    worker: Option<&str>,
    level: Option<&str>,
) -> io::Result<Value> {
    let normalized = query.trim().to_lowercase();
    let mut entries = Vec::new();
    let limit = limit.clamp(1, 1000) as usize;
    if !normalized.is_empty() {
        forward(path, |value, raw| {
            if matches(&value, worker, level) && text(&value, raw).contains(&normalized) {
                entries.push(value);
            }
            entries.len() < limit
        })?;
    }
    Ok(json!({"query":query,"total_returned":entries.len(),"entries":entries,"log_path":path}))
}

pub(crate) fn tail(
    path: &Path,
    limit: i64,
    worker: Option<&str>,
    level: Option<&str>,
) -> io::Result<Value> {
    let mut entries = Vec::new();
    let limit = limit.clamp(1, 1000) as usize;
    if let Some(mut file) = open(path)? {
        let mut position = file.seek(SeekFrom::End(0))?;
        let mut chunk = [0u8; CHUNK];
        let mut record = Vec::new();
        let mut oversized = false;
        'scan: while position > 0 {
            let count = position.min(CHUNK as u64) as usize;
            position -= count as u64;
            file.seek(SeekFrom::Start(position))?;
            file.read_exact(&mut chunk[..count])?;
            for byte in chunk[..count].iter().rev() {
                if *byte == b'\n' {
                    if !oversized {
                        record.reverse();
                        if let Some(value) = entry(&record) {
                            if matches(&value, worker, level) {
                                entries.push(value);
                                if entries.len() == limit {
                                    break 'scan;
                                }
                            }
                        }
                    }
                    record.clear();
                    oversized = false;
                } else if !oversized {
                    if record.len() < MAX_RECORD {
                        record.push(*byte);
                    } else {
                        record.clear();
                        oversized = true;
                    }
                }
            }
        }
        if entries.len() < limit && !oversized {
            record.reverse();
            if let Some(value) = entry(&record) {
                if matches(&value, worker, level) {
                    entries.push(value);
                }
            }
        }
    }
    entries.reverse();
    Ok(json!({"total_returned":entries.len(),"entries":entries,"log_path":path}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn fixture(raw: &[u8]) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(raw).unwrap();
        file
    }
    #[test]
    fn defaults_validation_and_integer_coercion() {
        assert_eq!(
            entry(b"{}"),
            Some(json!({"workerId":"","level":"log","ts":null,"args":[]}))
        );
        for raw in [
            br#"{"workerId":4}"#.as_slice(),
            br#"{"args":null}"#,
            br#"{"ts":1.2}"#,
            b"[]",
            b"broken",
        ] {
            assert!(entry(raw).is_none());
        }
        assert_eq!(entry(br#"{"ts":"123","extra":true}"#).unwrap()["ts"], 123);
        assert_eq!(entry(br#"{"ts":true}"#).unwrap()["ts"], 1);
        for ts in ["123.0", "+123", "1_23", " 123 "] {
            assert_eq!(
                entry(&serde_json::to_vec(&json!({"ts":ts})).unwrap()).unwrap()["ts"],
                123
            );
        }
        for ts in ["1e2", "_123", "1__2", "123.", "0x10"] {
            assert!(integer_string(ts).is_none());
        }
        assert_eq!(
            search_json("[1e-5,1e20,1.0,-0.0]"),
            "[1e-05, 1e+20, 1.0, -0.0]"
        );
    }
    #[test]
    fn ordering_filters_and_search_spacing() {
        let file = fixture(b"{\"workerId\":\"z\",\"args\":[\"First\"]}\ninvalid\n{\"workerId\":\"a\",\"level\":\"warn\",\"args\":[{\"key\":1}]}\n{\"workerId\":\"z\",\"args\":[\"LAST\"]}");
        assert_eq!(workers(file.path()).unwrap()["workers"], json!(["a", "z"]));
        let result = tail(file.path(), 2, None, None).unwrap();
        assert_eq!(result["entries"][0]["workerId"], "a");
        assert_eq!(result["entries"][1]["args"], json!(["LAST"]));
        assert_eq!(
            tail(file.path(), 0, Some("z"), None).unwrap()["entries"][0]["args"],
            json!(["LAST"])
        );
        assert_eq!(
            search(file.path(), "z", 1, None, None).unwrap()["entries"][0]["args"],
            json!(["First"])
        );
        assert_eq!(
            search(file.path(), "\"KEY\": 1", 100, None, Some("warn")).unwrap()["total_returned"],
            1
        );
        assert_eq!(
            search(file.path(), "  ", 100, None, None).unwrap()["total_returned"],
            0
        );
    }
    #[test]
    fn bounded_records_chunk_boundaries_unicode_and_invalid_utf8() {
        let mut raw =
            serde_json::to_vec(&json!({"workerId":"wide","args":["é".repeat(CHUNK)]})).unwrap();
        raw.push(b'\n');
        raw.extend(std::iter::repeat_n(b'x', MAX_RECORD + 1));
        raw.extend_from_slice(b"\n{}\n");
        let file = fixture(&raw);
        assert_eq!(
            tail(file.path(), 100, None, None).unwrap()["total_returned"],
            2
        );
        assert_eq!(
            search(file.path(), "wide", 100, None, None).unwrap()["total_returned"],
            1
        );
        let bad = fixture(b"\xff\n{}\n");
        assert_eq!(
            tail(bad.path(), 100, None, None).unwrap()["total_returned"],
            1
        );
        assert!(workers(bad.path()).is_err());
    }
    #[test]
    fn missing_file_and_limit_ceiling() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(
            workers(&root.path().join("missing")).unwrap()["workers"],
            json!([])
        );
        let file = fixture(&b"{}\n".repeat(1002));
        assert_eq!(
            tail(file.path(), 1001, None, None).unwrap()["total_returned"],
            1000
        );
    }

    #[test]
    fn shared_python_reference_fixture() {
        let data: Value = serde_json::from_str(include_str!(
            "../../../../mcp_probe/fixtures/console_projection.json"
        ))
        .unwrap();
        let raw = data["lines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|line| line.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        let file = fixture(raw.as_bytes());
        for case in data["cases"].as_array().unwrap() {
            let input = &case["input"];
            let limit = input["limit"].as_i64().unwrap_or(100);
            let worker = input["worker_id"].as_str();
            let level = input["level"].as_str();
            let mut result = match case["operation"].as_str().unwrap() {
                "workers" => workers(file.path()),
                "tail" => tail(file.path(), limit, worker, level),
                _ => search(
                    file.path(),
                    input["query"].as_str().unwrap(),
                    limit,
                    worker,
                    level,
                ),
            }
            .unwrap();
            result.as_object_mut().unwrap().remove("log_path");
            assert_eq!(result, case["expected"], "case: {case}");
        }
    }
}
