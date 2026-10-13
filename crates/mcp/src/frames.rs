//! Where rendered PNGs go when the caller names no output, and how they
//! come back as image content.

use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use base64::Engine;
use celesta_exporter::ExportedFile;
use rmcp::model::ContentBlock;

/// Most frames one `render_frames` call returns as images; the rest are
/// listed in the report only.
pub const MAX_INLINE_FRAMES: usize = 6;

/// A temporary folder, removed when the server exits, with a new subfolder
/// for each call so repeated checks never collide.
pub struct OutputDirs {
    root: tempfile::TempDir,
    next: AtomicU64,
}

impl OutputDirs {
    pub fn new() -> io::Result<Self> {
        Ok(Self {
            root: tempfile::Builder::new().prefix("celesta-mcp-").tempdir()?,
            next: AtomicU64::new(1),
        })
    }

    pub fn fresh(&self) -> io::Result<PathBuf> {
        let dir = self
            .root
            .path()
            .join(format!("{:04}", self.next.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir(&dir)?;
        Ok(dir)
    }
}

/// The written PNGs as image content, each after a line naming it: the
/// first [`MAX_INLINE_FRAMES`] frames, or a contact sheet.
pub fn image_blocks(files: &[ExportedFile]) -> io::Result<Vec<ContentBlock>> {
    let mut blocks = Vec::new();
    let mut frames = 0;
    for file in files {
        let (label, path) = match file {
            ExportedFile::Frame { path, frame } => {
                if frames == MAX_INLINE_FRAMES {
                    continue;
                }
                frames += 1;
                (format!("frame {frame}: {}", path.display()), path)
            }
            ExportedFile::ContactSheet { path, frames, .. } => (
                format!("contact sheet of frames {frames:?}: {}", path.display()),
                path,
            ),
            ExportedFile::Video { .. } => continue,
        };
        let png = std::fs::read(path)?;
        blocks.push(ContentBlock::text(label));
        blocks.push(ContentBlock::image(
            base64::engine::general_purpose::STANDARD.encode(png),
            "image/png",
        ));
    }
    Ok(blocks)
}
