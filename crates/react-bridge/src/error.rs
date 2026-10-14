use crate::properties::PropertyIssue;
use std::error::Error;
use std::path::PathBuf;
use std::{fmt, io};

#[derive(Debug)]
pub enum ReactBridgeError {
    Executable {
        executable: PathBuf,
        source: io::Error,
    },
    MissingPipe,
    Io(io::Error),
    Protocol(serde_json::Error),
    /// The runtime closed its stdout. `stderr` holds the last lines it wrote
    /// there, if any, which usually say why.
    UnexpectedExit {
        stderr: String,
    },
    UnexpectedResponse,
    EntryFailed(String),
    /// The entry rejected project property values before running `prepare()`.
    InvalidProperties(Vec<PropertyIssue>),
    Render(String),
    Time(celesta_composition::TimeError),
    /// The runtime ignored a request for a frame past the end: it is older
    /// than this bridge.
    OpenEndUnsupported,
    /// A frame referred to a `<Static>` subtree this bridge was never sent
    /// or has dropped.
    MissingStatic(u32),
}

impl fmt::Display for ReactBridgeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Executable { executable, source } => write!(
                formatter,
                "could not run {}: {source}",
                executable.display()
            ),
            Self::MissingPipe => {
                formatter.write_str("the Node.js React runtime did not provide its stdio pipes")
            }
            Self::Io(error) => write!(
                formatter,
                "could not communicate with the Node.js React runtime: {error}"
            ),
            Self::Protocol(error) => write!(
                formatter,
                "the Node.js React runtime sent an unexpected response: {error}"
            ),
            Self::UnexpectedExit { stderr } => {
                formatter.write_str("the Node.js React runtime exited unexpectedly")?;
                if stderr.is_empty() {
                    return Ok(());
                }
                formatter.write_str(". Its last output:")?;
                for line in stderr.lines() {
                    if line.is_empty() {
                        formatter.write_str("\n")?;
                    } else {
                        write!(formatter, "\n  {line}")?;
                    }
                }
                Ok(())
            }
            Self::UnexpectedResponse => formatter
                .write_str("the Node.js React runtime answered with the wrong kind of response"),
            Self::EntryFailed(error) => {
                write!(formatter, "could not load the React composition: {error}")
            }
            Self::InvalidProperties(issues) => {
                formatter.write_str("invalid project properties:")?;
                for issue in issues {
                    write!(formatter, "\n  - {issue}")?;
                }
                Ok(())
            }
            Self::Render(error) => write!(formatter, "could not render the composition: {error}"),
            Self::Time(error) => write!(formatter, "invalid composition time: {error}"),
            Self::OpenEndUnsupported => formatter.write_str(
                "the Node.js React runtime cannot evaluate frames past the end; it is older than this exporter",
            ),
            Self::MissingStatic(key) => write!(
                formatter,
                "the React runtime referred to static subtree {key}, which this bridge does not have"
            ),
        }
    }
}

impl Error for ReactBridgeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Executable { source, .. } | Self::Io(source) => Some(source),
            Self::Protocol(error) => Some(error),
            Self::MissingPipe
            | Self::UnexpectedExit { .. }
            | Self::UnexpectedResponse
            | Self::EntryFailed(_)
            | Self::InvalidProperties(_)
            | Self::Render(_)
            | Self::OpenEndUnsupported
            | Self::MissingStatic(_) => None,
            Self::Time(error) => Some(error),
        }
    }
}
