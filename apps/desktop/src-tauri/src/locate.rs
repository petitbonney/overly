//! Where the Node runtime and the server bundle are. Release builds only use the bundled copies;
//! debug builds fall back to `node` on PATH and the repository's server build.

use std::fmt;
use std::path::{Path, PathBuf};

/// The Node binary that Tauri's `externalBin` puts next to the shell executable.
pub const NODE_BINARY: &str = if cfg!(windows) { "node.exe" } else { "node" };

pub struct Environment<'a> {
    /// `OVERLY_NODE`.
    pub node_override: Option<PathBuf>,
    /// `OVERLY_SERVER_SCRIPT`.
    pub script_override: Option<PathBuf>,
    pub exe_dir: Option<PathBuf>,
    pub resource_dir: Option<PathBuf>,
    pub dev_fallbacks: bool,
    pub exists: &'a dyn Fn(&Path) -> bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocateError {
    pub what: &'static str,
    pub searched: Vec<PathBuf>,
}

impl fmt::Display for LocateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let paths: Vec<String> = self
            .searched
            .iter()
            .map(|path| path.display().to_string())
            .collect();
        write!(
            f,
            "Can't find the {} (looked in: {})",
            self.what,
            paths.join(", ")
        )
    }
}

impl std::error::Error for LocateError {}

const NODE: &str = "Node.js runtime";
const SCRIPT: &str = "Overly server script";

/// An override must exist: falling back silently would hide a typo in the variable.
fn from_override(
    path: &Option<PathBuf>,
    what: &'static str,
    env: &Environment,
) -> Option<Result<PathBuf, LocateError>> {
    let path = path.as_ref()?;
    Some(if (env.exists)(path) {
        Ok(path.clone())
    } else {
        Err(LocateError {
            what,
            searched: vec![path.clone()],
        })
    })
}

pub fn node_binary(env: &Environment) -> Result<PathBuf, LocateError> {
    if let Some(result) = from_override(&env.node_override, NODE, env) {
        return result;
    }
    let mut searched = Vec::new();
    if let Some(dir) = &env.exe_dir {
        let candidate = dir.join(NODE_BINARY);
        if (env.exists)(&candidate) {
            return Ok(candidate);
        }
        searched.push(candidate);
    }
    if env.dev_fallbacks {
        // Resolved through PATH when the process is spawned.
        return Ok(PathBuf::from("node"));
    }
    Err(LocateError {
        what: NODE,
        searched,
    })
}

pub fn server_script(env: &Environment) -> Result<PathBuf, LocateError> {
    if let Some(result) = from_override(&env.script_override, SCRIPT, env) {
        return result;
    }
    let mut candidates = Vec::new();
    if let Some(dir) = &env.resource_dir {
        candidates.push(dir.join("server").join("server.mjs"));
    }
    if env.dev_fallbacks {
        candidates.push(repo_server_script());
    }
    match candidates.iter().find(|path| (env.exists)(path)) {
        Some(path) => Ok(path.clone()),
        None => Err(LocateError {
            what: SCRIPT,
            searched: candidates,
        }),
    }
}

/// `apps/server/dist/sidecar/server.mjs` in this repository, built by `bun run build`.
pub fn repo_server_script() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../server/dist/sidecar/server.mjs")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(exists: &'a dyn Fn(&Path) -> bool) -> Environment<'a> {
        Environment {
            node_override: None,
            script_override: None,
            exe_dir: Some(PathBuf::from("/app")),
            resource_dir: Some(PathBuf::from("/res")),
            dev_fallbacks: false,
            exists,
        }
    }

    #[test]
    fn node_prefers_override_then_exe_dir_then_path() {
        let all = |_: &Path| true;
        let mut environment = env(&all);
        environment.node_override = Some(PathBuf::from("/custom/node"));
        assert_eq!(node_binary(&environment), Ok(PathBuf::from("/custom/node")));

        environment.node_override = None;
        assert_eq!(
            node_binary(&environment),
            Ok(Path::new("/app").join(NODE_BINARY))
        );

        let none = |_: &Path| false;
        let mut environment = env(&none);
        environment.dev_fallbacks = true;
        assert_eq!(node_binary(&environment), Ok(PathBuf::from("node")));
    }

    #[test]
    fn node_without_dev_fallbacks_is_an_error_listing_searched_paths() {
        let none = |_: &Path| false;
        let error = node_binary(&env(&none)).unwrap_err();
        assert_eq!(error.searched, vec![Path::new("/app").join(NODE_BINARY)]);
        assert!(
            error
                .to_string()
                .starts_with("Can't find the Node.js runtime (looked in: ")
        );
    }

    #[test]
    fn script_prefers_override_then_resources_then_repo() {
        let all = |_: &Path| true;
        let mut environment = env(&all);
        environment.script_override = Some(PathBuf::from("/custom/server.mjs"));
        assert_eq!(
            server_script(&environment),
            Ok(PathBuf::from("/custom/server.mjs"))
        );

        environment.script_override = None;
        assert_eq!(
            server_script(&environment),
            Ok(Path::new("/res").join("server").join("server.mjs"))
        );

        let only_repo = |path: &Path| path == repo_server_script();
        let mut environment = env(&only_repo);
        environment.dev_fallbacks = true;
        assert_eq!(server_script(&environment), Ok(repo_server_script()));

        environment.dev_fallbacks = false;
        let error = server_script(&environment).unwrap_err();
        assert_eq!(error.what, "Overly server script");
        assert_eq!(
            error.searched,
            vec![Path::new("/res").join("server").join("server.mjs")]
        );
    }

    #[test]
    fn missing_override_is_an_error() {
        let none = |_: &Path| false;
        let mut environment = env(&none);
        environment.dev_fallbacks = true;
        environment.node_override = Some(PathBuf::from("/missing/node"));
        environment.script_override = Some(PathBuf::from("/missing/server.mjs"));
        assert_eq!(
            node_binary(&environment).unwrap_err().searched,
            vec![PathBuf::from("/missing/node")]
        );
        assert_eq!(
            server_script(&environment).unwrap_err().searched,
            vec![PathBuf::from("/missing/server.mjs")]
        );
    }
}
