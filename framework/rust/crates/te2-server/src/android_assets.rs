use anyhow::{Context, Result, bail};
use axum::{
    Router,
    body::Body,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use glob::glob;
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    env, fs,
    io::Write,
    path::{Component, Path, PathBuf},
};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

use crate::{AppState, json_error};

const BUNDLE_MANIFEST_REL_PATH: &str = "app/android_editor_assets_bundle.json";

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/editor_version", get(editor_version))
        .route("/api/editor_assets_bundle", get(editor_assets_bundle))
}

async fn editor_version(State(state): State<AppState>) -> Response {
    match read_editor_version(Path::new(state.project_root())) {
        Ok(version) => text_response(version),
        Err(error) => {
            let status = if is_version_missing(&error) {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            json_error(
                status,
                &format!("Failed to read editor asset version: {error}"),
            )
        }
    }
}

async fn editor_assets_bundle(State(state): State<AppState>) -> Response {
    let project_root = PathBuf::from(state.project_root());
    match tokio::task::spawn_blocking(move || build_asset_bundle_payload(&project_root)).await {
        Ok(Ok(payload)) => zip_response(payload),
        Ok(Err(error)) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Failed to build editor asset bundle: {error}"),
        ),
        Err(error) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Editor asset bundle task failed: {error}"),
        ),
    }
}

#[derive(Debug, Deserialize)]
struct AssetBundleManifest {
    version_file: String,
    #[serde(default)]
    exclude_extensions: Vec<String>,
    #[serde(default)]
    exclude_dirs: Vec<String>,
    #[serde(default)]
    entries: Vec<AssetBundleEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum AssetBundleEntry {
    File {
        src: String,
        dest: String,
        #[serde(default = "default_required")]
        required: bool,
    },
    Tree {
        src: String,
        dest: String,
        #[serde(default = "default_required")]
        required: bool,
    },
    Glob {
        src: String,
        dest: String,
        #[serde(default = "default_required")]
        required: bool,
    },
    Template {
        src: String,
        dest: String,
        #[serde(default)]
        replacements: BTreeMap<String, String>,
        #[serde(default = "default_required")]
        required: bool,
    },
    Version {
        dest: String,
    },
}

#[derive(Debug)]
struct AssetBundleFile {
    version: String,
    path: PathBuf,
}

#[derive(Debug)]
struct AssetBundlePayload {
    version: String,
    bytes: Vec<u8>,
}

fn default_required() -> bool {
    true
}

fn read_editor_version(project_root: &Path) -> Result<String> {
    let manifest = load_manifest(project_root)?;
    let version_path = project_relative_path(project_root, &manifest.version_file)?;
    if !version_path.is_file() {
        bail!("version file not found at {}", version_path.display());
    }
    read_version_file(&version_path)
}

fn build_asset_bundle_payload(project_root: &Path) -> Result<AssetBundlePayload> {
    let bundle = build_asset_bundle_zip(project_root)?;
    let bytes =
        fs::read(&bundle.path).with_context(|| format!("read bundle {}", bundle.path.display()));
    let _ = fs::remove_file(&bundle.path);
    Ok(AssetBundlePayload {
        version: bundle.version,
        bytes: bytes?,
    })
}

fn build_asset_bundle_zip(project_root: &Path) -> Result<AssetBundleFile> {
    let manifest = load_manifest(project_root)?;
    let version_path = project_relative_path(project_root, &manifest.version_file)?;
    let version = read_version_file(&version_path)?;

    // This endpoint is a cold OTA path. Build from current sources so a forced
    // same-version refresh cannot receive an older mixed-generation archive.
    let temp_root = bundle_temp_root(project_root);
    fs::create_dir_all(&temp_root)
        .with_context(|| format!("create bundle temp root {}", temp_root.display()))?;
    let temp = tempfile::Builder::new()
        .prefix(&format!("editor_assets_{version}_"))
        .suffix(".zip")
        .tempfile_in(&temp_root)
        .with_context(|| format!("create temp bundle under {}", temp_root.display()))?;
    let mut zip = ZipWriter::new(temp);
    let options = zip_file_options();

    for entry in &manifest.entries {
        add_manifest_entry(&mut zip, options, project_root, &manifest, entry)?;
    }

    let temp = zip.finish().context("finish asset bundle zip")?;
    let (_file, path) = temp.keep().context("persist asset bundle zip")?;
    Ok(AssetBundleFile { version, path })
}

fn add_manifest_entry<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
    project_root: &Path,
    manifest: &AssetBundleManifest,
    entry: &AssetBundleEntry,
) -> Result<()> {
    match entry {
        AssetBundleEntry::File {
            src,
            dest,
            required,
        } => add_file_entry(zip, options, project_root, src, dest, *required),
        AssetBundleEntry::Tree {
            src,
            dest,
            required,
        } => add_tree_entry(zip, options, project_root, manifest, src, dest, *required),
        AssetBundleEntry::Glob {
            src,
            dest,
            required,
        } => add_glob_entry(zip, options, project_root, manifest, src, dest, *required),
        AssetBundleEntry::Template {
            src,
            dest,
            replacements,
            required,
        } => add_template_entry(
            zip,
            options,
            project_root,
            src,
            dest,
            replacements,
            *required,
        ),
        AssetBundleEntry::Version { dest } => {
            let arcname = validate_archive_path(dest)?;
            let version = read_editor_version(project_root)?;
            zip.start_file(arcname, options)?;
            zip.write_all(version.as_bytes())?;
            Ok(())
        }
    }
}

fn add_file_entry<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
    project_root: &Path,
    src: &str,
    dest: &str,
    required: bool,
) -> Result<()> {
    let src_path = project_relative_path(project_root, src)?;
    if !src_path.is_file() {
        if required {
            bail!("required bundle file missing: {}", src_path.display());
        }
        return Ok(());
    }
    let arcname = validate_archive_path(dest)?;
    write_file_to_zip(zip, options, &src_path, &arcname)
}

fn add_tree_entry<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
    project_root: &Path,
    manifest: &AssetBundleManifest,
    src: &str,
    dest: &str,
    required: bool,
) -> Result<()> {
    let src_root = project_relative_path(project_root, src)?;
    if !src_root.is_dir() {
        if required {
            bail!("required bundle tree missing: {}", src_root.display());
        }
        return Ok(());
    }
    let dest_root = validate_archive_path(dest)?;
    add_tree_files(zip, options, manifest, &src_root, &src_root, &dest_root)
}

fn add_glob_entry<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
    project_root: &Path,
    manifest: &AssetBundleManifest,
    src: &str,
    dest: &str,
    required: bool,
) -> Result<()> {
    let pattern = project_glob_pattern(project_root, src)?;
    let dest_root = validate_archive_path(dest)?;
    let mut matches = Vec::new();
    for candidate in glob(&pattern).with_context(|| format!("read glob pattern {src}"))? {
        let path = candidate.with_context(|| format!("read glob candidate for {src}"))?;
        if path.is_file() && should_include_path(manifest, &path) {
            matches.push(path);
        }
    }
    matches.sort();
    if matches.is_empty() && required {
        bail!("required bundle glob matched no files: {src}");
    }
    for path in matches {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .context("glob match missing UTF-8 file name")?;
        let arcname = join_archive_path(&dest_root, file_name)?;
        write_file_to_zip(zip, options, &path, &arcname)?;
    }
    Ok(())
}

fn add_template_entry<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
    project_root: &Path,
    src: &str,
    dest: &str,
    replacements: &BTreeMap<String, String>,
    required: bool,
) -> Result<()> {
    let src_path = project_relative_path(project_root, src)?;
    if !src_path.is_file() {
        if required {
            bail!("required bundle template missing: {}", src_path.display());
        }
        return Ok(());
    }
    let mut content =
        fs::read_to_string(&src_path).with_context(|| format!("read {}", src_path.display()))?;
    for (needle, replacement) in replacements {
        content = content.replace(needle, replacement);
    }
    let arcname = validate_archive_path(dest)?;
    zip.start_file(arcname, options)?;
    zip.write_all(content.as_bytes())?;
    Ok(())
}

fn add_tree_files<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
    manifest: &AssetBundleManifest,
    source_root: &Path,
    current: &Path,
    dest_root: &str,
) -> Result<()> {
    let mut entries = fs::read_dir(current)
        .with_context(|| format!("read dir {}", current.display()))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .with_context(|| format!("collect dir {}", current.display()))?;
    entries.sort_by_key(|entry| entry.path());

    for entry in entries {
        let path = entry.path();
        if !should_include_path(manifest, &path) {
            continue;
        }
        let metadata = fs::metadata(&path).with_context(|| format!("stat {}", path.display()))?;
        if metadata.is_dir() {
            add_tree_files(zip, options, manifest, source_root, &path, dest_root)?;
        } else if metadata.is_file() {
            let relative = path.strip_prefix(source_root).with_context(|| {
                format!("strip {} from {}", source_root.display(), path.display())
            })?;
            let relative = archive_path_from_path(relative)?;
            let arcname = join_archive_path(dest_root, &relative)?;
            write_file_to_zip(zip, options, &path, &arcname)?;
        }
    }
    Ok(())
}

fn write_file_to_zip<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
    src_path: &Path,
    arcname: &str,
) -> Result<()> {
    let body = fs::read(src_path).with_context(|| format!("read {}", src_path.display()))?;
    zip.start_file(arcname, options)?;
    zip.write_all(&body)?;
    Ok(())
}

fn load_manifest(project_root: &Path) -> Result<AssetBundleManifest> {
    let path = project_root.join(BUNDLE_MANIFEST_REL_PATH);
    let text = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parse {}", path.display()))
}

fn read_version_file(path: &Path) -> Result<String> {
    let version = fs::read_to_string(path)
        .with_context(|| format!("read version file {}", path.display()))?
        .trim()
        .to_owned();
    if version.is_empty() {
        bail!("version file is empty at {}", path.display());
    }
    Ok(version)
}

fn project_relative_path(project_root: &Path, relative: &str) -> Result<PathBuf> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute() || contains_parent_dir(relative_path) {
        bail!("bundle path must stay project-relative: {relative}");
    }
    Ok(project_root.join(relative_path))
}

fn project_glob_pattern(project_root: &Path, relative: &str) -> Result<String> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute() || contains_parent_dir(relative_path) {
        bail!("bundle glob must stay project-relative: {relative}");
    }
    Ok(project_root
        .join(relative_path)
        .to_string_lossy()
        .into_owned())
}

fn contains_parent_dir(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn should_include_path(manifest: &AssetBundleManifest, path: &Path) -> bool {
    let excluded_dir = path.components().any(|component| {
        let Component::Normal(part) = component else {
            return false;
        };
        let Some(part) = part.to_str() else {
            return false;
        };
        manifest.exclude_dirs.iter().any(|exclude| exclude == part)
    });
    if excluded_dir {
        return false;
    }

    let suffix = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"));
    !suffix
        .as_ref()
        .is_some_and(|suffix| manifest.exclude_extensions.contains(suffix))
}

fn validate_archive_path(path: &str) -> Result<String> {
    let archive_path = Path::new(path);
    if path.trim().is_empty() || archive_path.is_absolute() || contains_parent_dir(archive_path) {
        bail!("invalid archive path: {path}");
    }
    archive_path_from_path(archive_path)
}

fn archive_path_from_path(path: &Path) -> Result<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let part = part
                    .to_str()
                    .with_context(|| format!("archive path is not UTF-8: {}", path.display()))?;
                parts.push(part.to_owned());
            }
            Component::CurDir => {}
            _ => bail!("invalid archive path component in {}", path.display()),
        }
    }
    if parts.is_empty() {
        bail!("archive path cannot be empty");
    }
    Ok(parts.join("/"))
}

fn join_archive_path(prefix: &str, suffix: &str) -> Result<String> {
    validate_archive_path(&format!("{prefix}/{suffix}"))
}

fn zip_file_options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644)
}

fn bundle_temp_root(project_root: &Path) -> PathBuf {
    env::var_os("TEMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            project_root
                .join("framework")
                .join("rust")
                .join("target")
                .join("editor-assets-bundles")
        })
}

fn text_response(content: String) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
        .body(Body::from(content))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn zip_response(payload: AssetBundlePayload) -> Response {
    let filename = format!("editor_assets_{}.zip", payload.version);
    Response::builder()
        .header(header::CONTENT_TYPE, "application/zip")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(payload.bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn is_version_missing(error: &anyhow::Error) -> bool {
    error
        .chain()
        .any(|cause| cause.to_string().contains("version file not found"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs::File, io::Read};
    use zip::ZipArchive;

    #[test]
    fn bundle_manifest_builds_expected_zip_entries() {
        let temp = temp_project();
        write_file(
            temp.path().join("app/apps/code_te2/static/version.txt"),
            "9.8.7\n",
        );
        write_file(temp.path().join("app/static/file.js"), "file body");
        write_file(temp.path().join("app/static/tree/keep.txt"), "tree body");
        write_file(temp.path().join("app/static/tree/skip.map"), "skip");
        write_file(
            temp.path().join("app/static/tree/node_modules/pkg.js"),
            "skip",
        );
        write_file(temp.path().join("app/static/chunk-one.js"), "chunk body");
        write_file(temp.path().join("app/static/no-match.css"), "no");
        write_file(
            temp.path().join("app/templates/app_shell.html"),
            "hello TOKEN",
        );
        write_file(
            temp.path().join(BUNDLE_MANIFEST_REL_PATH),
            r#"{
              "version_file": "app/apps/code_te2/static/version.txt",
              "exclude_extensions": [".map"],
              "exclude_dirs": ["node_modules"],
              "entries": [
                { "kind": "file", "src": "app/static/file.js", "dest": "static/file.js" },
                { "kind": "tree", "src": "app/static/tree", "dest": "static/tree" },
                { "kind": "glob", "src": "app/static/chunk-*.js", "dest": "static/chunks" },
                {
                  "kind": "template",
                  "src": "app/templates/app_shell.html",
                  "dest": "app_shell.html",
                  "replacements": { "TOKEN": "world" }
                },
                { "kind": "file", "src": "app/static/missing.js", "dest": "static/missing.js", "required": false },
                { "kind": "version", "dest": "version.txt" }
              ]
            }"#,
        );

        let bundle = build_asset_bundle_zip(temp.path()).unwrap();
        assert_eq!(bundle.version, "9.8.7");

        let mut archive = ZipArchive::new(File::open(bundle.path).unwrap()).unwrap();
        assert_eq!(read_zip_string(&mut archive, "static/file.js"), "file body");
        assert_eq!(
            read_zip_string(&mut archive, "static/tree/keep.txt"),
            "tree body"
        );
        assert_eq!(
            read_zip_string(&mut archive, "static/chunks/chunk-one.js"),
            "chunk body"
        );
        assert_eq!(
            read_zip_string(&mut archive, "app_shell.html"),
            "hello world"
        );
        assert_eq!(read_zip_string(&mut archive, "version.txt"), "9.8.7");
        assert!(archive.by_name("static/tree/skip.map").is_err());
        assert!(archive.by_name("static/tree/node_modules/pkg.js").is_err());
        assert!(archive.by_name("static/missing.js").is_err());
    }

    #[test]
    fn version_endpoint_source_comes_from_manifest_version_file() {
        let temp = temp_project();
        write_file(temp.path().join("custom/version/location.txt"), "2.4.6\n");
        write_file(
            temp.path().join(BUNDLE_MANIFEST_REL_PATH),
            r#"{
              "version_file": "custom/version/location.txt",
              "entries": []
            }"#,
        );

        assert_eq!(read_editor_version(temp.path()).unwrap(), "2.4.6");
    }

    #[test]
    fn same_version_bundle_rebuild_reads_current_source_bytes() {
        let temp = temp_project();
        let version_path = temp.path().join("app/apps/code_te2/static/version.txt");
        let source_path = temp.path().join("app/static/touch.js");
        write_file(version_path, "3.2.1\n");
        write_file(source_path.clone(), "old touch bundle");
        write_file(
            temp.path().join(BUNDLE_MANIFEST_REL_PATH),
            r#"{
              "version_file": "app/apps/code_te2/static/version.txt",
              "entries": [
                { "kind": "file", "src": "app/static/touch.js", "dest": "static/touch.js" },
                { "kind": "version", "dest": "version.txt" }
              ]
            }"#,
        );

        let first = build_asset_bundle_zip(temp.path()).unwrap();
        let mut first_archive = ZipArchive::new(File::open(first.path).unwrap()).unwrap();
        assert_eq!(
            read_zip_string(&mut first_archive, "static/touch.js"),
            "old touch bundle"
        );

        write_file(source_path, "new touch bundle");
        let second = build_asset_bundle_zip(temp.path()).unwrap();
        let mut second_archive = ZipArchive::new(File::open(second.path).unwrap()).unwrap();
        assert_eq!(
            read_zip_string(&mut second_archive, "static/touch.js"),
            "new touch bundle"
        );
    }

    #[test]
    fn production_bundle_manifest_required_sources_exist() {
        let project_root = repo_root();
        let manifest = load_manifest(&project_root).unwrap();
        assert_eq!(
            read_editor_version(&project_root).unwrap(),
            fs::read_to_string(project_root.join(&manifest.version_file))
                .unwrap()
                .trim()
        );

        for entry in &manifest.entries {
            assert_required_source_exists(&project_root, &manifest, entry);
        }
    }

    fn temp_project() -> tempfile::TempDir {
        let parent = env::var_os("TEMPDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("target")
                    .join("android-assets-test")
            });
        fs::create_dir_all(&parent).unwrap();
        tempfile::Builder::new()
            .prefix("te2-android-assets-")
            .tempdir_in(parent)
            .unwrap()
    }

    fn write_file(path: PathBuf, body: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    fn read_zip_string(archive: &mut ZipArchive<File>, name: &str) -> String {
        let mut file = archive.by_name(name).unwrap();
        let mut body = String::new();
        file.read_to_string(&mut body).unwrap();
        body
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(4)
            .unwrap()
            .to_path_buf()
    }

    fn assert_required_source_exists(
        project_root: &Path,
        manifest: &AssetBundleManifest,
        entry: &AssetBundleEntry,
    ) {
        match entry {
            AssetBundleEntry::File {
                src,
                dest,
                required,
            } => {
                validate_archive_path(dest).unwrap();
                let src_path = project_relative_path(project_root, src).unwrap();
                if *required {
                    assert!(src_path.is_file(), "required file missing: {src}");
                }
            }
            AssetBundleEntry::Tree {
                src,
                dest,
                required,
            } => {
                validate_archive_path(dest).unwrap();
                let src_path = project_relative_path(project_root, src).unwrap();
                if *required {
                    assert!(src_path.is_dir(), "required tree missing: {src}");
                }
            }
            AssetBundleEntry::Glob {
                src,
                dest,
                required,
            } => {
                validate_archive_path(dest).unwrap();
                let pattern = project_glob_pattern(project_root, src).unwrap();
                let matches = glob(&pattern)
                    .unwrap()
                    .filter_map(Result::ok)
                    .filter(|path| path.is_file() && should_include_path(manifest, path))
                    .count();
                if *required {
                    assert!(matches > 0, "required glob matched no files: {src}");
                }
            }
            AssetBundleEntry::Template {
                src,
                dest,
                required,
                ..
            } => {
                validate_archive_path(dest).unwrap();
                let src_path = project_relative_path(project_root, src).unwrap();
                if *required {
                    assert!(src_path.is_file(), "required template missing: {src}");
                }
            }
            AssetBundleEntry::Version { dest } => {
                validate_archive_path(dest).unwrap();
            }
        }
    }
}
