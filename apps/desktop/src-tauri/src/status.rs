//! What the sidecar is doing, as shown in the tray.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    Starting,
    Running { port: u16 },
    Restarting { attempt: u32 },
    Fatal { message: String },
    Stopping,
    Stopped,
}

impl Status {
    /// The text of the tray's status item.
    pub fn label(&self) -> String {
        match self {
            Status::Starting => "Starting…".into(),
            Status::Running { port } => format!("Running on port {port}"),
            Status::Restarting { attempt } => format!("Restarting (attempt {attempt})…"),
            Status::Fatal { message } => format!("Error: {message}"),
            Status::Stopping => "Stopping…".into(),
            Status::Stopped => "Stopped".into(),
        }
    }

    pub fn tooltip(&self) -> String {
        format!("Overly — {}", self.label())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_match_the_tray_copy() {
        assert_eq!(Status::Starting.label(), "Starting…");
        assert_eq!(
            Status::Running { port: 6859 }.label(),
            "Running on port 6859"
        );
        assert_eq!(
            Status::Restarting { attempt: 3 }.label(),
            "Restarting (attempt 3)…"
        );
        assert_eq!(
            Status::Fatal {
                message: "Port 6859 is in use".into()
            }
            .label(),
            "Error: Port 6859 is in use"
        );
        assert_eq!(Status::Stopping.label(), "Stopping…");
        assert_eq!(Status::Stopped.label(), "Stopped");
    }

    #[test]
    fn tooltip_names_the_app() {
        assert_eq!(
            Status::Running { port: 6859 }.tooltip(),
            "Overly — Running on port 6859"
        );
    }
}
