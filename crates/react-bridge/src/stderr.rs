//! Node's stderr: passed through to this process's stderr as it arrives,
//! with its last lines kept to explain an unexpected exit.

use crate::error::ReactBridgeError;
use std::collections::VecDeque;
use std::io::{self, BufRead, BufReader, Write};
use std::process::{Child, ChildStderr};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

/// How many of the runtime's last stderr lines an exit error keeps.
pub(crate) const MAX_LINES: usize = 40;
/// How many bytes of those lines it keeps, at most.
pub(crate) const MAX_BYTES: usize = 8 * 1024;
/// How long an exit error waits for the runtime to exit and its stderr to
/// close. A grandchild can hold the pipe open past the runtime's exit.
const EXIT_WAIT: Duration = Duration::from_millis(500);

/// The last lines of a stream, within [`MAX_LINES`] and [`MAX_BYTES`];
/// the oldest go first.
#[derive(Default)]
pub(crate) struct StderrTail {
    lines: VecDeque<String>,
    bytes: usize,
}

impl StderrTail {
    /// Adds one line, without its line ending. A line longer than
    /// [`MAX_BYTES`] keeps only its start.
    pub(crate) fn push(&mut self, line: &str) {
        let mut end = line.len().min(MAX_BYTES);
        while !line.is_char_boundary(end) {
            end -= 1;
        }
        let line = &line[..end];
        self.bytes += line.len();
        self.lines.push_back(line.to_owned());
        while self.lines.len() > MAX_LINES || self.bytes > MAX_BYTES {
            let Some(oldest) = self.lines.pop_front() else {
                break;
            };
            self.bytes -= oldest.len();
        }
    }

    /// The kept lines joined with `\n`, without trailing blank lines.
    pub(crate) fn text(&self) -> String {
        let kept = self
            .lines
            .iter()
            .rposition(|line| !line.trim().is_empty())
            .map_or(0, |last| last + 1);
        let lines: Vec<&str> = self.lines.iter().take(kept).map(String::as_str).collect();
        lines.join("\n")
    }
}

/// Copies `reader` to `forward` line by line, unchanged, and keeps each line
/// in `tail`. Stops at the end of `reader` or on a read error; a failed
/// write is ignored so the runtime never blocks on a full pipe.
pub(crate) fn pump(mut reader: impl BufRead, mut forward: impl Write, tail: &Mutex<StderrTail>) {
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let _ = forward.write_all(&line).and_then(|()| forward.flush());
        let text = line.strip_suffix(b"\n").unwrap_or(&line);
        let text = text.strip_suffix(b"\r").unwrap_or(text);
        tail.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(&String::from_utf8_lossy(text));
    }
}

/// The runtime's stderr, read on its own thread.
///
/// The thread holds only the pipe and the tail. It ends when the pipe
/// closes, which killing the runtime does, and nothing joins it, so it
/// keeps neither the bridge nor this process alive.
pub(crate) struct StderrCapture {
    tail: Arc<Mutex<StderrTail>>,
    /// Disconnects when the thread has read the pipe to its end.
    closed: Receiver<()>,
}

impl StderrCapture {
    pub(crate) fn start(stderr: ChildStderr) -> io::Result<Self> {
        let tail = Arc::new(Mutex::new(StderrTail::default()));
        let (closed_sender, closed) = mpsc::channel::<()>();
        let thread_tail = Arc::clone(&tail);
        thread::Builder::new()
            .name("celesta-node-stderr".to_owned())
            .spawn(move || {
                let _closed = closed_sender;
                pump(BufReader::new(stderr), io::stderr(), &thread_tail);
            })?;
        Ok(Self { tail, closed })
    }

    /// Fills in why the runtime went away. An [`ReactBridgeError::UnexpectedExit`],
    /// or a write the closed pipe refused, becomes an `UnexpectedExit`
    /// carrying the runtime's last stderr lines; other errors pass through.
    ///
    /// It first waits for `child` to exit and then for its stderr to reach
    /// its end, both within [`EXIT_WAIT`], so the lines are complete.
    pub(crate) fn exit_error(
        &self,
        child: &mut Child,
        error: ReactBridgeError,
    ) -> ReactBridgeError {
        match &error {
            ReactBridgeError::UnexpectedExit { .. } => {}
            ReactBridgeError::Io(io) if io.kind() == io::ErrorKind::BrokenPipe => {}
            _ => return error,
        }
        let deadline = Instant::now() + EXIT_WAIT;
        while matches!(child.try_wait(), Ok(None)) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        let _ = self
            .closed
            .recv_timeout(deadline.saturating_duration_since(Instant::now()));
        let stderr = self
            .tail
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .text();
        ReactBridgeError::UnexpectedExit { stderr }
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_BYTES, MAX_LINES, StderrTail, pump};
    use std::io::Cursor;
    use std::sync::Mutex;

    #[test]
    fn keeps_only_the_last_lines() {
        let mut tail = StderrTail::default();
        for line in 0..MAX_LINES + 5 {
            tail.push(&format!("line {line}"));
        }
        let text = tail.text();
        assert_eq!(text.lines().count(), MAX_LINES);
        assert_eq!(text.lines().next(), Some("line 5"));
        assert_eq!(
            text.lines().last(),
            Some(format!("line {}", MAX_LINES + 4).as_str())
        );
    }

    #[test]
    fn drops_the_oldest_lines_past_the_byte_cap() {
        let mut tail = StderrTail::default();
        let line = "x".repeat(MAX_BYTES / 4);
        tail.push("first");
        for _ in 0..4 {
            tail.push(&line);
        }
        let text = tail.text();
        assert!(!text.contains("first"), "the oldest line goes first");
        assert_eq!(text.lines().count(), 4);
        tail.push("last");
        let text = tail.text();
        assert_eq!(text.lines().count(), 4, "one long line made room");
        assert_eq!(text.lines().last(), Some("last"));
    }

    #[test]
    fn truncates_a_line_longer_than_the_byte_cap() {
        let mut tail = StderrTail::default();
        tail.push("before");
        // A multi-byte character straddles the cap.
        tail.push(&format!("{}é{}", "a".repeat(MAX_BYTES - 1), "b".repeat(10)));
        let text = tail.text();
        assert_eq!(text, "a".repeat(MAX_BYTES - 1));
    }

    #[test]
    fn trims_trailing_blank_lines_only() {
        let mut tail = StderrTail::default();
        for line in ["Error: boom", "", "Node.js v24.0.0", "", "  "] {
            tail.push(line);
        }
        assert_eq!(tail.text(), "Error: boom\n\nNode.js v24.0.0");
    }

    #[test]
    fn forwards_output_unchanged_and_keeps_a_partial_last_line() {
        let tail = Mutex::new(StderrTail::default());
        let mut forwarded = Vec::new();
        let input = b"first\r\nsecond\nno newline";
        pump(Cursor::new(input), &mut forwarded, &tail);
        assert_eq!(forwarded, input);
        assert_eq!(
            tail.into_inner().unwrap().text(),
            "first\nsecond\nno newline"
        );
    }
}
