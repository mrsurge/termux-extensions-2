use std::{collections::HashMap, env, path::PathBuf};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Te2Paths {
    pub cache_home: PathBuf,
    pub data_home: PathBuf,
    pub config_home: PathBuf,
    pub runtime_home: PathBuf,
}

impl Te2Paths {
    pub(crate) fn from_env() -> Result<Self, String> {
        let environ = env::vars().collect::<HashMap<_, _>>();
        let home = environ
            .get("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(home_dir);
        resolve_te2_paths(&environ, home, env::temp_dir(), unsafe { libc::geteuid() })
    }
}

pub(crate) fn cache_home() -> PathBuf {
    Te2Paths::from_env()
        .unwrap_or_else(|error| panic!("invalid TE2 path configuration: {error}"))
        .cache_home
}

pub(crate) fn data_home() -> PathBuf {
    Te2Paths::from_env()
        .unwrap_or_else(|error| panic!("invalid TE2 path configuration: {error}"))
        .data_home
}

pub(crate) fn config_home() -> PathBuf {
    Te2Paths::from_env()
        .unwrap_or_else(|error| panic!("invalid TE2 path configuration: {error}"))
        .config_home
}

fn resolve_te2_paths(
    environ: &HashMap<String, String>,
    home: PathBuf,
    platform_temp: PathBuf,
    uid: u32,
) -> Result<Te2Paths, String> {
    Ok(Te2Paths {
        cache_home: persistent_home(
            environ,
            "TE2_CACHE_HOME",
            "XDG_CACHE_HOME",
            home.join(".cache"),
        )?,
        data_home: persistent_home(
            environ,
            "TE2_DATA_HOME",
            "XDG_DATA_HOME",
            home.join(".local").join("share"),
        )?,
        config_home: persistent_home(
            environ,
            "TE2_CONFIG_HOME",
            "XDG_CONFIG_HOME",
            home.join(".config"),
        )?,
        runtime_home: runtime_home(environ, platform_temp, uid)?,
    })
}

fn persistent_home(
    environ: &HashMap<String, String>,
    explicit_key: &str,
    xdg_key: &str,
    fallback: PathBuf,
) -> Result<PathBuf, String> {
    if let Some(raw) = nonempty(environ.get(explicit_key)) {
        return absolute_path(raw, explicit_key);
    }
    if let Some(raw) = nonempty(environ.get(xdg_key)) {
        return Ok(absolute_path(raw, xdg_key)?.join("te2"));
    }
    require_absolute(&fallback, "HOME")?;
    Ok(fallback.join("te2"))
}

fn runtime_home(
    environ: &HashMap<String, String>,
    platform_temp: PathBuf,
    uid: u32,
) -> Result<PathBuf, String> {
    if let Some(raw) = nonempty(environ.get("TE2_RUNTIME_HOME")) {
        return absolute_path(raw, "TE2_RUNTIME_HOME");
    }
    if let Some(raw) = nonempty(environ.get("XDG_RUNTIME_DIR")) {
        return Ok(absolute_path(raw, "XDG_RUNTIME_DIR")?.join("te2"));
    }

    let temporary_root = if let Some(raw) = nonempty(environ.get("TMPDIR")) {
        absolute_path(raw, "TMPDIR")?
    } else if is_termux(environ) {
        match nonempty(environ.get("PREFIX")) {
            Some(raw) => absolute_path(raw, "PREFIX")?.join("tmp"),
            None => absolute_platform_temp(platform_temp)?,
        }
    } else {
        absolute_platform_temp(platform_temp)?
    };
    Ok(temporary_root.join(format!("te2-{uid}")))
}

fn absolute_platform_temp(path: PathBuf) -> Result<PathBuf, String> {
    require_absolute(&path, "platform temporary directory")?;
    Ok(path)
}

fn absolute_path(raw: &str, key: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    require_absolute(&path, key)?;
    Ok(path)
}

fn require_absolute(path: &PathBuf, key: &str) -> Result<(), String> {
    if path.is_absolute() {
        Ok(())
    } else {
        Err(format!("{key} must be an absolute path: {path:?}"))
    }
}

fn nonempty(value: Option<&String>) -> Option<&str> {
    value
        .map(String::as_str)
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
}

fn is_termux(environ: &HashMap<String, String>) -> bool {
    environ
        .get("ANDROID_ROOT")
        .is_some_and(|value| !value.trim().is_empty())
        || environ
            .get("ANDROID_DATA")
            .is_some_and(|value| !value.trim().is_empty())
        || environ
            .get("PREFIX")
            .is_some_and(|value| value.contains("/com.termux/"))
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_roots_are_final_and_xdg_bases_receive_te2() {
        let environ = HashMap::from([
            ("TE2_CACHE_HOME".to_owned(), "/custom/cache".to_owned()),
            ("XDG_DATA_HOME".to_owned(), "/xdg/data".to_owned()),
            ("XDG_CONFIG_HOME".to_owned(), "/xdg/config".to_owned()),
            ("XDG_RUNTIME_DIR".to_owned(), "/run/user/1000".to_owned()),
        ]);
        let paths = resolve_te2_paths(
            &environ,
            PathBuf::from("/home/test"),
            PathBuf::from("/tmp"),
            1000,
        )
        .expect("paths");
        assert_eq!(paths.cache_home, PathBuf::from("/custom/cache"));
        assert_eq!(paths.data_home, PathBuf::from("/xdg/data/te2"));
        assert_eq!(paths.config_home, PathBuf::from("/xdg/config/te2"));
        assert_eq!(paths.runtime_home, PathBuf::from("/run/user/1000/te2"));
    }

    #[test]
    fn termux_without_xdg_uses_home_and_prefix_fallbacks() {
        let environ = HashMap::from([(
            "PREFIX".to_owned(),
            "/data/data/com.termux/files/usr".to_owned(),
        )]);
        let paths = resolve_te2_paths(
            &environ,
            PathBuf::from("/data/data/com.termux/files/home"),
            PathBuf::from("/ignored"),
            10234,
        )
        .expect("paths");
        assert_eq!(
            paths.cache_home,
            PathBuf::from("/data/data/com.termux/files/home/.cache/te2")
        );
        assert_eq!(
            paths.data_home,
            PathBuf::from("/data/data/com.termux/files/home/.local/share/te2")
        );
        assert_eq!(
            paths.runtime_home,
            PathBuf::from("/data/data/com.termux/files/usr/tmp/te2-10234")
        );
    }

    #[test]
    fn complete_explicit_roots_do_not_consult_lower_priority_fallbacks() {
        let environ = HashMap::from([
            ("TE2_CACHE_HOME".to_owned(), "/explicit/cache".to_owned()),
            ("TE2_DATA_HOME".to_owned(), "/explicit/data".to_owned()),
            ("TE2_CONFIG_HOME".to_owned(), "/explicit/config".to_owned()),
            (
                "TE2_RUNTIME_HOME".to_owned(),
                "/explicit/runtime".to_owned(),
            ),
        ]);
        let paths = resolve_te2_paths(
            &environ,
            PathBuf::from("relative-home"),
            PathBuf::from("relative-temp"),
            1000,
        )
        .expect("explicit paths");
        assert_eq!(paths.cache_home, PathBuf::from("/explicit/cache"));
        assert_eq!(paths.data_home, PathBuf::from("/explicit/data"));
        assert_eq!(paths.config_home, PathBuf::from("/explicit/config"));
        assert_eq!(paths.runtime_home, PathBuf::from("/explicit/runtime"));
    }

    #[test]
    fn relative_override_is_rejected() {
        let environ = HashMap::from([("TE2_CACHE_HOME".to_owned(), "relative".to_owned())]);
        let error = resolve_te2_paths(
            &environ,
            PathBuf::from("/home/test"),
            PathBuf::from("/tmp"),
            1000,
        )
        .expect_err("relative path must fail");
        assert!(error.contains("TE2_CACHE_HOME must be an absolute path"));
    }
}
