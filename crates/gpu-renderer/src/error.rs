use crate::transform::MAX_CLIP_DEPTH;
use crate::types::{GpuDriver, ReadbackFormat};
use celesta_media::MediaError;
use celesta_remote::RemoteAssetError;
use celesta_renderer::RenderError;
use std::error::Error;
use std::{fmt, io};

#[derive(Debug)]
pub enum GpuRenderError {
    /// This build cannot render through the driver on this platform.
    DriverUnavailable(GpuDriver),
    RequestAdapter(wgpu::RequestAdapterError),
    RequestDevice(wgpu::RequestDeviceError),
    Poll(wgpu::PollError),
    Map(wgpu::BufferAsyncError),
    MapRange(wgpu::MapRangeError),
    MapCallbackDropped,
    /// The thread that reads pipelined frames back could not be started.
    ReadbackThread(io::Error),
    AssetIo {
        asset: String,
        source: io::Error,
    },
    ImageDecode {
        asset: String,
        source: image::ImageError,
    },
    Psd(RenderError),
    Media(MediaError),
    Text(RenderError),
    Effects(RenderError),
    /// A custom shader that does not compile, or a layer's use of one that
    /// does not match it. `shader` is its name, or its id when unnamed.
    Shader {
        shader: String,
        message: String,
    },
    /// A layer's built-in filter with a value the renderer cannot use.
    /// `filter` is its type, such as `brightness` or `chromaKey`.
    BuiltinFilter {
        filter: &'static str,
        message: String,
    },
    InvalidImageData {
        width: u32,
        height: u32,
        expected: usize,
        actual: usize,
    },
    RemoteAsset {
        asset: String,
        source: RemoteAssetError,
    },
    MissingVideoDecoder(String),
    UnsupportedContent {
        layer: String,
        content: &'static str,
    },
    InvalidSurfaceSize {
        width: u32,
        height: u32,
    },
    InvalidTargetSize {
        width: u32,
        height: u32,
    },
    IncompatibleSurface,
    SurfaceNotConfigured,
    SurfaceValidation,
    SurfaceTooLarge {
        width: u32,
        height: u32,
    },
    NativePreview(i32),
    /// The GPU cannot produce frames in this [`ReadbackFormat`].
    UnsupportedReadbackFormat(ReadbackFormat),
    /// [`ReadbackFormat::Yuv420p`] and [`ReadbackFormat::Yuv420p10`]
    /// subsample chroma 2x2, so they need even dimensions.
    OddYuv420pSize {
        width: u32,
        height: u32,
    },
    /// A frame has more layers than one GPU buffer can hold.
    TooManyLayers(usize),
    /// Clipped groups are nested deeper than the shader walks.
    ClipsNestedTooDeep(u32),
    /// A frame's paths have more edges than one GPU buffer can hold.
    PathsTooComplex(usize),
}

impl GpuRenderError {
    /// Whether the error comes from the scene being drawn (an asset, text,
    /// a shader or filter, too many layers or paths) rather than from the
    /// GPU, its readback, or the surface. After a scene error, the next
    /// scene can still be rendered; after any other, it would most likely
    /// fail the same way.
    pub fn is_scene_error(&self) -> bool {
        match self {
            Self::AssetIo { .. }
            | Self::ImageDecode { .. }
            | Self::Psd(_)
            | Self::Media(_)
            | Self::Text(_)
            | Self::Effects(_)
            | Self::Shader { .. }
            | Self::BuiltinFilter { .. }
            | Self::InvalidImageData { .. }
            | Self::RemoteAsset { .. }
            | Self::MissingVideoDecoder(_)
            | Self::UnsupportedContent { .. }
            | Self::TooManyLayers(_)
            | Self::ClipsNestedTooDeep(_)
            | Self::PathsTooComplex(_) => true,
            Self::DriverUnavailable(_)
            | Self::RequestAdapter(_)
            | Self::RequestDevice(_)
            | Self::Poll(_)
            | Self::Map(_)
            | Self::MapRange(_)
            | Self::MapCallbackDropped
            | Self::ReadbackThread(_)
            | Self::InvalidSurfaceSize { .. }
            | Self::InvalidTargetSize { .. }
            | Self::IncompatibleSurface
            | Self::SurfaceNotConfigured
            | Self::SurfaceValidation
            | Self::SurfaceTooLarge { .. }
            | Self::NativePreview(_)
            | Self::UnsupportedReadbackFormat(_)
            | Self::OddYuv420pSize { .. } => false,
        }
    }
}

impl fmt::Display for GpuRenderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DriverUnavailable(driver) => {
                write!(
                    formatter,
                    "the {driver} driver is not available on this platform"
                )
            }
            Self::RequestAdapter(error) => write!(formatter, "could not select a GPU: {error}"),
            Self::RequestDevice(error) => write!(formatter, "could not open the GPU: {error}"),
            Self::Poll(error) => write!(formatter, "could not wait for GPU work: {error}"),
            Self::Map(error) => write!(formatter, "could not read the GPU frame: {error}"),
            Self::MapRange(error) => {
                write!(formatter, "could not access the mapped GPU frame: {error}")
            }
            Self::MapCallbackDropped => formatter.write_str("GPU readback callback was dropped"),
            Self::ReadbackThread(error) => {
                write!(
                    formatter,
                    "could not start the GPU readback thread: {error}"
                )
            }
            Self::AssetIo { asset, source } => {
                write!(formatter, "could not read GPU asset {asset}: {source}")
            }
            Self::ImageDecode { asset, source } => {
                write!(formatter, "could not decode GPU image {asset}: {source}")
            }
            Self::Psd(error) => write!(formatter, "could not rasterize GPU PSD: {error}"),
            Self::Media(error) => write!(formatter, "could not decode GPU video frame: {error}"),
            Self::Text(error) => write!(formatter, "could not rasterize GPU text: {error}"),
            Self::Effects(error) => write!(formatter, "invalid GPU layer effect: {error}"),
            Self::Shader { shader, message } => {
                write!(formatter, "invalid custom shader {shader}: {message}")
            }
            Self::BuiltinFilter { filter, message } => {
                write!(formatter, "invalid {filter} filter: {message}")
            }
            Self::InvalidImageData {
                width,
                height,
                expected,
                actual,
            } => write!(
                formatter,
                "invalid {width}x{height} RGBA image: expected {expected} bytes, got {actual}"
            ),
            Self::RemoteAsset { asset, source } => {
                write!(formatter, "could not load remote asset `{asset}`: {source}")
            }
            Self::MissingVideoDecoder(layer) => {
                write!(
                    formatter,
                    "GPU video layer {layer} requires a video decoder"
                )
            }
            Self::UnsupportedContent { layer, content } => {
                write!(
                    formatter,
                    "GPU layer {layer} uses unsupported {content} content"
                )
            }
            Self::InvalidSurfaceSize { width, height } => {
                write!(
                    formatter,
                    "GPU frame size must be non-zero, got {width}x{height}"
                )
            }
            Self::InvalidTargetSize { width, height } => {
                write!(
                    formatter,
                    "GPU target size must be non-zero, got {width}x{height}"
                )
            }
            Self::IncompatibleSurface => {
                formatter.write_str("GPU adapter is incompatible with the preview surface")
            }
            Self::SurfaceNotConfigured => {
                formatter.write_str("preview surface has not been configured")
            }
            Self::SurfaceValidation => {
                formatter.write_str("preview surface reported a validation error")
            }
            Self::SurfaceTooLarge { width, height } => {
                write!(formatter, "GPU frame is too large: {width}x{height}")
            }
            Self::NativePreview(status) => {
                write!(
                    formatter,
                    "could not create native preview surface ({status})"
                )
            }
            Self::UnsupportedReadbackFormat(format) => {
                write!(formatter, "this GPU cannot read frames back as {format:?}")
            }
            Self::OddYuv420pSize { width, height } => write!(
                formatter,
                "yuv420p readback requires even dimensions, got {width}x{height}"
            ),
            Self::TooManyLayers(layers) => {
                write!(formatter, "frame has too many layers for the GPU: {layers}")
            }
            Self::ClipsNestedTooDeep(depth) => write!(
                formatter,
                "clipped groups are nested {depth} deep, more than the GPU renderer's limit of {MAX_CLIP_DEPTH}"
            ),
            Self::PathsTooComplex(entries) => write!(
                formatter,
                "frame's paths exceed the GPU storage buffer: {entries} tile and edge entries"
            ),
        }
    }
}

impl Error for GpuRenderError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::RequestAdapter(error) => Some(error),
            Self::RequestDevice(error) => Some(error),
            Self::Poll(error) => Some(error),
            Self::Map(error) => Some(error),
            Self::MapRange(error) => Some(error),
            Self::ReadbackThread(error) => Some(error),
            Self::AssetIo { source, .. } => Some(source),
            Self::ImageDecode { source, .. } => Some(source),
            Self::RemoteAsset { source, .. } => Some(source),
            Self::Psd(error) => Some(error),
            Self::Media(error) => Some(error),
            Self::Text(error) => Some(error),
            Self::Effects(error) => Some(error),
            Self::DriverUnavailable(_)
            | Self::MapCallbackDropped
            | Self::TooManyLayers(_)
            | Self::ClipsNestedTooDeep(_)
            | Self::PathsTooComplex(_)
            | Self::Shader { .. }
            | Self::BuiltinFilter { .. }
            | Self::InvalidImageData { .. }
            | Self::MissingVideoDecoder(_)
            | Self::UnsupportedContent { .. }
            | Self::InvalidSurfaceSize { .. }
            | Self::InvalidTargetSize { .. }
            | Self::IncompatibleSurface
            | Self::SurfaceNotConfigured
            | Self::SurfaceValidation
            | Self::SurfaceTooLarge { .. }
            | Self::NativePreview(_)
            | Self::UnsupportedReadbackFormat(_)
            | Self::OddYuv420pSize { .. } => None,
        }
    }
}

impl From<MediaError> for GpuRenderError {
    fn from(error: MediaError) -> Self {
        Self::Media(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_errors_are_told_apart_from_gpu_failures() {
        let color = RenderError::InvalidColor("ink".to_owned());
        assert!(GpuRenderError::Text(color).is_scene_error());
        assert!(GpuRenderError::PathsTooComplex(1 << 24).is_scene_error());
        assert!(!GpuRenderError::Poll(wgpu::PollError::Timeout).is_scene_error());
        assert!(!GpuRenderError::MapCallbackDropped.is_scene_error());
        assert!(!GpuRenderError::ReadbackThread(io::Error::other("no threads")).is_scene_error());
    }
}
