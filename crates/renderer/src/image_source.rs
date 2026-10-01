//! Shared raster and SVG decoding and display-box layout for both renderers.
use celesta_composition::ImageFit;
use image::{ImageReader, RgbaImage};
use resvg::{tiny_skia, usvg};
use std::{collections::HashMap, path::Path, sync::Arc};

#[derive(Default)]
pub struct ImageSources {
    sources: HashMap<String, Source>,
    rendered: HashMap<String, (String, DisplayImage)>,
}
enum Source {
    Raster(Arc<RgbaImage>),
    Svg(Box<usvg::Tree>),
}

#[derive(Clone)]
pub struct DisplayImage {
    pub pixels: Arc<RgbaImage>,
    pub width: f64,
    pub height: f64,
    /// SVG pixels are rasterized at the requested display density.
    pub is_svg: bool,
}

impl ImageSources {
    /// Adds decoded pixels, allowing callers to share an existing asset cache.
    pub fn insert_raster(&mut self, key: &str, pixels: RgbaImage) {
        self.sources
            .entry(key.to_owned())
            .or_insert(Source::Raster(Arc::new(pixels)));
    }

    pub fn render(
        &mut self,
        key: &str,
        path: &Path,
        width: Option<f64>,
        height: Option<f64>,
        fit: Option<ImageFit>,
        density: f64,
    ) -> Result<DisplayImage, image::ImageError> {
        if !self.sources.contains_key(key) {
            let data = std::fs::read(path)?;
            let svg = path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("svg"))
                || std::str::from_utf8(&data).is_ok_and(|s| s.contains("<svg"));
            let source = if svg {
                let text = std::str::from_utf8(&data).map_err(invalid)?;
                let text = css_fallbacks(text);
                let mut options = usvg::Options {
                    resources_dir: path.parent().map(Path::to_path_buf),
                    ..Default::default()
                };
                options.fontdb_mut().load_system_fonts();
                Source::Svg(Box::new(
                    usvg::Tree::from_str(&text, &options).map_err(invalid)?,
                ))
            } else {
                Source::Raster(Arc::new(
                    ImageReader::new(std::io::Cursor::new(data))
                        .with_guessed_format()?
                        .decode()?
                        .to_rgba8(),
                ))
            };
            self.sources.insert(key.to_owned(), source);
        }
        let source = &self.sources[key];
        let (sw, sh) = match source {
            Source::Raster(image) => (image.width() as f64, image.height() as f64),
            Source::Svg(tree) => (tree.size().width() as f64, tree.size().height() as f64),
        };
        let (w, h) = match (width, height) {
            (Some(w), Some(h)) => (w, h),
            (Some(w), None) => (w, w * sh / sw),
            (None, Some(h)) => (h * sw / sh, h),
            (None, None) => (sw, sh),
        };
        if !w.is_finite() || !h.is_finite() || w <= 0.0 || h <= 0.0 {
            return Err(invalid("image dimensions must be finite and positive"));
        }
        if fit.is_none()
            && let Source::Raster(pixels) = source
        {
            return Ok(DisplayImage {
                pixels: pixels.clone(),
                width: w,
                height: h,
                is_svg: false,
            });
        }
        // SVG rasterization follows the
        // complete parent transform, including animated scale and rotation.
        let density = match source {
            Source::Svg(_) => density.max(1.0),
            Source::Raster(_) => 1.0,
        };
        let pw = (w * density).ceil();
        let ph = (h * density).ceil();
        if !pw.is_finite()
            || !ph.is_finite()
            || pw > 16384.0
            || ph > 16384.0
            || pw * ph > 64_000_000.0
        {
            return Err(invalid("image display size exceeds rasterization limits"));
        }
        let (pw, ph) = (pw as u32, ph as u32);
        let signature = format!("{w}:{h}:{pw}:{ph}:{fit:?}");
        if let Some((previous, image)) = self.rendered.get(key)
            && previous == &signature
        {
            return Ok(image.clone());
        }
        let (sx, sy) = (pw as f64 / sw, ph as f64 / sh);
        let (sx, sy) = match fit {
            Some(ImageFit::Contain) => (sx.min(sy), sx.min(sy)),
            Some(ImageFit::Cover) => (sx.max(sy), sx.max(sy)),
            None => (sx, sy),
        };
        let (ox, oy) = ((pw as f64 - sw * sx) / 2.0, (ph as f64 - sh * sy) / 2.0);
        let pixels = match source {
            Source::Svg(tree) => {
                let mut pixmap = tiny_skia::Pixmap::new(pw, ph)
                    .ok_or_else(|| invalid("invalid SVG raster size"))?;
                resvg::render(
                    tree,
                    tiny_skia::Transform::from_row(
                        sx as f32, 0.0, 0.0, sy as f32, ox as f32, oy as f32,
                    ),
                    &mut pixmap.as_mut(),
                );
                // tiny-skia uses premultiplied alpha; Celesta stores straight RGBA.
                for pixel in pixmap.data_mut().chunks_exact_mut(4) {
                    if pixel[3] != 0 {
                        for channel in 0..3 {
                            pixel[channel] = ((pixel[channel] as u32 * 255 + pixel[3] as u32 / 2)
                                / pixel[3] as u32)
                                .min(255) as u8;
                        }
                    }
                }
                RgbaImage::from_raw(pw, ph, pixmap.take())
                    .ok_or_else(|| invalid("invalid SVG pixels"))?
            }
            Source::Raster(image) => {
                let mut output = RgbaImage::new(pw, ph);
                for (x, y, pixel) in output.enumerate_pixels_mut() {
                    let x = (x as f64 + 0.5 - ox) / sx;
                    let y = (y as f64 + 0.5 - oy) / sy;
                    if x >= 0.0 && y >= 0.0 && x < sw && y < sh {
                        *pixel = *image.get_pixel(x as u32, y as u32);
                    }
                }
                output
            }
        };
        let image = DisplayImage {
            pixels: Arc::new(pixels),
            width: w,
            height: h,
            is_svg: matches!(source, Source::Svg(_)),
        };
        // Retain only the latest resolution for each source during animation.
        self.rendered
            .insert(key.to_owned(), (signature, image.clone()));
        Ok(image)
    }
}
fn invalid(error: impl std::fmt::Display) -> image::ImageError {
    image::ImageError::IoError(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        error.to_string(),
    ))
}

// Resolve design-tool var(--name, fallback) expressions, including nested
// functions. The original SVG's background and other geometry are preserved.
fn css_fallbacks(input: &str) -> String {
    let mut output = String::new();
    let mut rest = input;
    while let Some(start) = rest.find("var(") {
        output.push_str(&rest[..start]);
        let expression = &rest[start + 4..];
        let mut depth = 1;
        let mut comma = None;
        let mut end = None;
        for (index, ch) in expression.char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(index);
                        break;
                    }
                }
                ',' if depth == 1 && comma.is_none() => comma = Some(index),
                _ => {}
            }
        }
        let Some(end) = end else {
            output.push_str(&rest[start..]);
            return output;
        };
        if let Some(comma) = comma {
            output.push_str(&css_fallbacks(expression[comma + 1..end].trim()));
        } else {
            output.push_str(&rest[start..start + 4 + end + 1]);
        }
        rest = &expression[end + 1..];
    }
    output.push_str(rest);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raster_fit_preserves_aspect_ratio_and_centers_or_crops() {
        let mut cache = ImageSources::default();
        cache.insert_raster(
            "photo",
            RgbaImage::from_fn(4, 2, |x, _| image::Rgba([x as u8 * 60, 0, 0, 255])),
        );
        let path = Path::new("not-read.png");
        let sized = cache
            .render("photo", path, Some(8.0), None, None, 1.0)
            .unwrap();
        assert_eq!((sized.width, sized.height), (8.0, 4.0));
        let contain = cache
            .render(
                "photo",
                path,
                Some(4.0),
                Some(4.0),
                Some(ImageFit::Contain),
                1.0,
            )
            .unwrap();
        assert_eq!(contain.pixels.get_pixel(0, 0).0[3], 0);
        assert_eq!(contain.pixels.get_pixel(0, 1).0[3], 255);
        let cover = cache
            .render(
                "photo",
                path,
                Some(2.0),
                Some(2.0),
                Some(ImageFit::Cover),
                1.0,
            )
            .unwrap();
        assert_eq!(cover.pixels.get_pixel(0, 0).0, [60, 0, 0, 255]);
        assert_eq!(cover.pixels.get_pixel(1, 1).0, [120, 0, 0, 255]);
        let again = cache
            .render(
                "photo",
                path,
                Some(2.0),
                Some(2.0),
                Some(ImageFit::Cover),
                1.0,
            )
            .unwrap();
        assert!(Arc::ptr_eq(&cover.pixels, &again.pixels));
    }
    #[test]
    fn missing_invalid_and_oversized_images_return_asset_errors() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("invalid.svg");
        let mut cache = ImageSources::default();
        assert!(
            cache
                .render("missing", &path, None, None, None, 1.0)
                .is_err()
        );
        std::fs::write(&path, "invalid SVG").unwrap();
        assert!(
            cache
                .render("invalid", &path, None, None, None, 1.0)
                .is_err()
        );
        cache.insert_raster("size", RgbaImage::new(1, 1));
        for width in [0.0, -1.0, f64::NAN, 20000.0] {
            assert!(
                cache
                    .render(
                        "size",
                        &path,
                        Some(width),
                        None,
                        Some(ImageFit::Contain),
                        1.0
                    )
                    .is_err()
            );
        }
    }
    #[test]
    fn resolves_nested_css_fallbacks() {
        assert_eq!(
            css_fallbacks("fill:var(--a, var(--b, rgb(255, 0, 0)))"),
            "fill:rgb(255, 0, 0)"
        );
    }
    #[test]
    fn svg_uses_display_size_and_scale_and_straight_alpha() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("logo.svg");
        std::fs::write(&path, r#"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="var(--fill, white)" opacity="0.5"/></svg>"#).unwrap();
        let result = ImageSources::default()
            .render("logo", &path, Some(40.0), None, None, 2.0)
            .unwrap();
        assert_eq!(
            (result.width, result.height, result.pixels.dimensions()),
            (40.0, 20.0, (80, 40))
        );
        assert_eq!(result.pixels.get_pixel(40, 20).0, [255, 255, 255, 128]);
    }
}
