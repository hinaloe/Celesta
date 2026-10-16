use crate::hit::HitClip;
use celesta_composition::{Clip, EvaluatedTransform, IDENTITY3, Matrix3, Point};
use celesta_renderer::PathTransform;

/// Evaluates an unparented Path layer's transform using the GPU renderer's
/// layer evaluator and precision. Path commands use local coordinates;
/// the layer's anchor does not offset them.
pub fn path_transform(transform: &EvaluatedTransform) -> PathTransform {
    LayerState::default().then(transform, 1.0).transform.into()
}

#[derive(Clone, Copy)]
pub(crate) struct LayerState {
    pub(crate) transform: Affine,
    pub(crate) opacity: f32,
    /// Index into `GpuRenderer::clip_entries` of the innermost clip the
    /// layer is drawn through.
    pub(crate) clip: Option<u32>,
}

impl LayerState {
    pub(crate) fn then(self, transform: &EvaluatedTransform, opacity: f64) -> Self {
        self.then_affine(Affine::from_transform(transform), opacity)
    }

    pub(crate) fn then_affine(self, transform: Affine, opacity: f64) -> Self {
        Self {
            transform: self.transform.multiply(transform),
            opacity: (self.opacity * opacity.clamp(0.0, 1.0) as f32).clamp(0.0, 1.0),
            clip: self.clip,
        }
    }
}

/// What `prepare_layer` carries down the layer tree besides the `LayerState`
/// that drawn items keep: state only the walk itself reads, so prepared items
/// stay small.
#[derive(Clone, Copy)]
pub(crate) struct Walk {
    /// The accumulated 3D linear part of the layer's ancestors and itself,
    /// which decides whether its back faces the viewer.
    pub(crate) orientation: Matrix3,
    /// How much larger than its layer-space size an effect's pixels are
    /// drawn, so a blur or shadow radius follows the layer's projection.
    #[allow(dead_code, reason = "read once projective layers set it")]
    pub(crate) effect_scale: f32,
    /// Index into `GpuRenderer::plane_entries` of the projective plane the
    /// layer is drawn onto, if any.
    pub(crate) plane: Option<u32>,
}

impl Default for Walk {
    fn default() -> Self {
        Self {
            orientation: IDENTITY3,
            effect_scale: 1.0,
            plane: None,
        }
    }
}

impl Default for LayerState {
    fn default() -> Self {
        Self {
            transform: Affine::IDENTITY,
            opacity: 1.0,
            clip: None,
        }
    }
}

/// The largest magnitude an affine entry may have before the layer is not
/// drawn.
const MAX_ENTRY: f32 = 1e7;

/// The deepest nesting of clipped groups `layer.wgsl` walks (`MAX_CLIP_DEPTH`
/// there).
pub(crate) const MAX_CLIP_DEPTH: u32 = 8;

/// Floats of one clip in the storage buffer `layer.wgsl` reads: three
/// `vec4<f32>`s.
pub(crate) const CLIP_ENTRY_FLOATS: usize = 12;
pub(crate) const CLIP_ENTRY_SIZE: u64 = CLIP_ENTRY_FLOATS as u64 * 4;

/// One clipped group, in the form the fragment shader evaluates: the canvas
/// position of a pixel maps into the group's frame (relative to the clip
/// rectangle's centre), where a rounded-box distance gives the coverage.
pub(crate) struct ClipEntry {
    /// The inverse of the group's transform, `a`..`d`, then the translation
    /// that also moves the clip rectangle's centre to the origin.
    pub(crate) inverse: [f32; 6],
    pub(crate) half: [f32; 2],
    pub(crate) radius: f32,
    /// Local distance to canvas pixels, `sqrt(|det|)`; the same factor
    /// `celesta-renderer` uses.
    pub(crate) distance_scale: f32,
    /// The clip this one is nested in.
    pub(crate) parent: Option<u32>,
    /// 1 for a clip that is not nested.
    pub(crate) depth: u32,
}

impl ClipEntry {
    pub(crate) fn new(clip: &Clip, transform: Affine, parent: Option<u32>, depth: u32) -> Self {
        let determinant = transform.a * transform.d - transform.b * transform.c;
        let a = transform.d / determinant;
        let b = -transform.b / determinant;
        let c = -transform.c / determinant;
        let d = transform.a / determinant;
        let tx = -(a * transform.tx + c * transform.ty);
        let ty = -(b * transform.tx + d * transform.ty);
        let center_x = (clip.x + clip.width / 2.0) as f32;
        let center_y = (clip.y + clip.height / 2.0) as f32;
        Self {
            inverse: [a, b, c, d, tx - center_x, ty - center_y],
            half: [(clip.width / 2.0) as f32, (clip.height / 2.0) as f32],
            radius: clip.effective_corner_radius() as f32,
            distance_scale: determinant.abs().sqrt(),
            parent,
            depth,
        }
    }

    pub(crate) fn floats(&self) -> [f32; CLIP_ENTRY_FLOATS] {
        let [a, b, c, d, tx, ty] = self.inverse;
        [
            a,
            b,
            c,
            d,
            tx,
            ty,
            self.half[0],
            self.half[1],
            self.radius,
            self.distance_scale,
            self.parent.map_or(-1.0, |parent| parent as f32),
            0.0,
        ]
    }

    /// The clip's shape for `hit_test`.
    pub(crate) const fn hit_clip(&self) -> HitClip {
        HitClip {
            inverse: self.inverse,
            half: self.half,
            radius: self.radius,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Affine {
    pub(crate) a: f32,
    pub(crate) b: f32,
    pub(crate) c: f32,
    pub(crate) d: f32,
    pub(crate) tx: f32,
    pub(crate) ty: f32,
}

impl From<Affine> for PathTransform {
    fn from(transform: Affine) -> Self {
        Self {
            a: f64::from(transform.a),
            b: f64::from(transform.b),
            c: f64::from(transform.c),
            d: f64::from(transform.d),
            tx: f64::from(transform.tx),
            ty: f64::from(transform.ty),
        }
    }
}

impl Affine {
    pub(crate) const IDENTITY: Self = Self {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        tx: 0.0,
        ty: 0.0,
    };

    pub(crate) fn from_transform(transform: &EvaluatedTransform) -> Self {
        Self::from_linear(&transform.linear(), transform.position)
    }

    /// The transform of a layer whose 3D linear part is `linear`, with the
    /// z axis dropped.
    pub(crate) fn from_linear(linear: &Matrix3, position: Point) -> Self {
        Self {
            a: linear[0][0] as f32,
            b: linear[1][0] as f32,
            c: linear[0][1] as f32,
            d: linear[1][1] as f32,
            tx: position.x as f32,
            ty: position.y as f32,
        }
    }

    pub(crate) fn multiply(self, child: Self) -> Self {
        Self {
            a: self.a * child.a + self.c * child.b,
            b: self.b * child.a + self.d * child.b,
            c: self.a * child.c + self.c * child.d,
            d: self.b * child.c + self.d * child.d,
            tx: self.a * child.tx + self.c * child.ty + self.tx,
            ty: self.b * child.tx + self.d * child.ty + self.ty,
        }
    }

    /// Whether the transform collapses the layer to nothing, or is so
    /// stretched (a skew near ±90°) that drawing it would only overflow.
    pub(crate) fn is_degenerate(self) -> bool {
        let entries = [self.a, self.b, self.c, self.d, self.tx, self.ty];
        let determinant = self.a * self.d - self.b * self.c;
        entries
            .iter()
            .any(|entry| !entry.is_finite() || entry.abs() > MAX_ENTRY)
            || !determinant.is_finite()
            || determinant.abs() <= f32::EPSILON
    }

    /// The largest and smallest factors the transform stretches a length by
    /// (its singular values).
    pub(crate) fn stretch(self) -> (f32, f32) {
        let sum = self.a * self.a + self.b * self.b + self.c * self.c + self.d * self.d;
        let determinant = (self.a * self.d - self.b * self.c).abs();
        let root = (sum * sum - 4.0 * determinant * determinant)
            .max(0.0)
            .sqrt();
        (
            ((sum + root) / 2.0).sqrt(),
            ((sum - root) / 2.0).max(0.0).sqrt(),
        )
    }

    /// How many texels of a texture with `raster_scale` texels per layer unit
    /// fall across one canvas pixel along the most shrunk direction.
    pub(crate) fn texels_per_pixel(self, raster_scale: f32) -> f32 {
        raster_scale / self.stretch().1.max(f32::MIN_POSITIVE)
    }

    /// Whether the transform only scales by `scale`, without rotating or
    /// mirroring, up to f32 rounding (a 360° rotation counts).
    pub(crate) fn is_uniform_scale(self, scale: f32) -> bool {
        let tolerance = 1e-5 * scale;
        (self.a - scale).abs() <= tolerance
            && self.b.abs() <= tolerance
            && self.c.abs() <= tolerance
            && (self.d - scale).abs() <= tolerance
    }
}
