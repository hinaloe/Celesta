//! Where rendered PNGs go when the caller names no output, and how they
//! come back as image content.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use base64::Engine;
use celesta_exporter::ExportedFile;
use rmcp::model::ContentBlock;

/// Most frames one `render_frames` call returns as images; the rest are
/// listed in the report only.
pub const MAX_INLINE_FRAMES: usize = 6;

/// Longest side of an image returned inline; larger PNGs are sent
/// downscaled (the file keeps its size), so clients' per-image limits are
/// not exceeded.
pub const MAX_INLINE_EDGE: u32 = 1568;

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
            ExportedFile::Video { .. } | ExportedFile::Subtitles { .. } => continue,
        };
        let (png, shown) = inline_png(path)?;
        let label = match shown {
            Some((width, height)) => format!("{label} (shown at {width}×{height})"),
            None => label,
        };
        blocks.push(ContentBlock::text(label));
        blocks.push(ContentBlock::image(
            base64::engine::general_purpose::STANDARD.encode(png),
            "image/png",
        ));
    }
    Ok(blocks)
}

/// PNG bytes to send inline, with the size they show when downscaled.
type InlinePng = (Vec<u8>, Option<(u32, u32)>);

/// The PNG at `path`, downscaled when a side exceeds [`MAX_INLINE_EDGE`];
/// the size it is shown at when it was.
fn inline_png(path: &Path) -> io::Result<InlinePng> {
    let bytes = std::fs::read(path)?;
    let invalid = |error: png::DecodingError| io::Error::new(io::ErrorKind::InvalidData, error);
    let mut reader = png::Decoder::new(io::Cursor::new(&bytes))
        .read_info()
        .map_err(invalid)?;
    let info = reader.info();
    let (width, height) = (info.width, info.height);
    let rgba8 = info.color_type == png::ColorType::Rgba && info.bit_depth == png::BitDepth::Eight;
    if width.max(height) <= MAX_INLINE_EDGE || !rgba8 {
        return Ok((bytes, None));
    }
    let mut pixels = vec![0; reader.output_buffer_size().unwrap_or(0)];
    reader.next_frame(&mut pixels).map_err(invalid)?;
    let longest = width.max(height);
    let scaled = |side: u32| {
        ((u64::from(side) * u64::from(MAX_INLINE_EDGE) + u64::from(longest) / 2)
            / u64::from(longest))
        .max(1) as u32
    };
    let (small_width, small_height) = (scaled(width), scaled(height));
    // The source pixels target pixel `i` of `small` covers out of `large`.
    let span = |i: u32, small: u32, large: u32| {
        let start = (u64::from(i) * u64::from(large) / u64::from(small)) as u32;
        let end = (u64::from(i + 1) * u64::from(large) / u64::from(small)) as u32;
        start..end.max(start + 1).min(large)
    };
    let mut small = Vec::with_capacity((small_width * small_height * 4) as usize);
    for y in 0..small_height {
        for x in 0..small_width {
            // Average the source pixels this one covers.
            let mut sum = [0u32; 4];
            let mut count = 0;
            for sy in span(y, small_height, height) {
                for sx in span(x, small_width, width) {
                    let at = ((sy * width + sx) * 4) as usize;
                    for (channel, total) in sum.iter_mut().enumerate() {
                        *total += u32::from(pixels[at + channel]);
                    }
                    count += 1;
                }
            }
            small.extend(sum.map(|total| ((total + count / 2) / count) as u8));
        }
    }
    let mut encoded = Vec::new();
    let mut encoder = png::Encoder::new(&mut encoded, small_width, small_height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let encode = |error: png::EncodingError| io::Error::other(error);
    encoder
        .write_header()
        .map_err(encode)?
        .write_image_data(&small)
        .map_err(encode)?;
    Ok((encoded, Some((small_width, small_height))))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_png(path: &std::path::Path, width: u32, height: u32) {
        let mut encoder = png::Encoder::new(std::fs::File::create(path).unwrap(), width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let pixels: Vec<u8> = (0..width * height)
            .flat_map(|i| [(i % 256) as u8, 0x40, 0x80, 0xff])
            .collect();
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&pixels)
            .unwrap();
    }

    fn decoded_size(block: &ContentBlock) -> (u32, u32) {
        let image = block.as_image().expect("an image block");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&image.data)
            .unwrap();
        let reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .unwrap();
        (reader.info().width, reader.info().height)
    }

    #[test]
    fn large_frames_are_downscaled_inline_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("frame.png");
        write_png(&path, 3200, 1800);
        let blocks = image_blocks(&[ExportedFile::Frame {
            path: path.clone(),
            frame: 0,
        }])
        .unwrap();
        let (width, height) = decoded_size(&blocks[1]);
        assert!(
            width <= MAX_INLINE_EDGE && height <= MAX_INLINE_EDGE,
            "{width}×{height}"
        );
        assert_eq!((width, height), (1568, 882));
        let on_disk =
            png::Decoder::new(std::io::BufReader::new(std::fs::File::open(&path).unwrap()))
                .read_info()
                .unwrap();
        assert_eq!(on_disk.info().width, 3200);
    }

    #[test]
    fn full_hd_frames_fit_the_inline_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("frame.png");
        write_png(&path, 1080, 1920);
        let blocks = image_blocks(&[ExportedFile::Frame { path, frame: 0 }]).unwrap();
        assert_eq!(decoded_size(&blocks[1]), (882, 1568));
        assert!(
            blocks[0]
                .as_text()
                .unwrap()
                .text
                .ends_with("(shown at 882×1568)")
        );
    }

    #[test]
    fn small_frames_are_sent_as_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("frame.png");
        write_png(&path, 1280, 720);
        let written = std::fs::read(&path).unwrap();
        let blocks = image_blocks(&[ExportedFile::Frame { path, frame: 0 }]).unwrap();
        let image = blocks[1].as_image().unwrap();
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(&image.data)
                .unwrap(),
            written
        );
    }
}
