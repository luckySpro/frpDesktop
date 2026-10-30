//! Small filesystem helpers shared by config / settings / installer code.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Write `bytes` to `path` atomically: temp file in the same directory, fsync,
/// then rename. When `backup` is true the previous file is kept as `<name>.bak`.
pub fn atomic_write(path: &Path, bytes: &[u8], backup: bool) -> AppResult<()> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::msg(format!("无效路径: {}", path.display())))?;
    std::fs::create_dir_all(dir)?;
    let name = path
        .file_name()
        .ok_or_else(|| AppError::msg(format!("无效路径: {}", path.display())))?
        .to_string_lossy()
        .to_string();
    let tmp = dir.join(format!(".{name}.tmp-{}", std::process::id()));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    if backup && path.exists() {
        let _ = std::fs::copy(path, dir.join(format!("{name}.bak")));
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// Resolve a path from the config against the frpc working directory.
/// Absolute inputs are returned as-is.
pub fn resolve_relative(base: &Path, p: &str) -> PathBuf {
    let pb = PathBuf::from(p);
    if pb.is_absolute() {
        pb
    } else {
        base.join(pb)
    }
}

/// A plain file name without any directory component (rejects `..`, `/`, `\`).
pub fn safe_file_name(name: &str) -> AppResult<&str> {
    let ok = !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0');
    if ok {
        Ok(name)
    } else {
        Err(AppError::msg(format!("非法文件名: {name}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_keeps_backup() {
        let dir = std::env::temp_dir().join(format!("frpd-fsutil-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let f = dir.join("a.toml");
        atomic_write(&f, b"one", true).unwrap();
        atomic_write(&f, b"two", true).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "two");
        assert_eq!(
            std::fs::read_to_string(dir.join("a.toml.bak")).unwrap(),
            "one"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn safe_names() {
        assert!(safe_file_name("a.crt").is_ok());
        assert!(safe_file_name("../a.crt").is_err());
        assert!(safe_file_name("x/a.crt").is_err());
        assert!(safe_file_name("..").is_err());
    }
}
