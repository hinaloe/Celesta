//! 3×3 matrix math for planar transforms: affine maps and the homographies
//! that perspective turns them into.

use crate::model::{EvaluatedTransform, Point};
use serde::{Deserialize, Serialize};

/// A row-major 3×3 matrix acting on column vectors `(x, y, 1)`.
pub type Matrix3 = [[f64; 3]; 3];

pub const IDENTITY3: Matrix3 = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];

/// Entries smaller than this are noise, not a projective part or an orientation.
const EPSILON: f64 = 1e-12;

/// Whether a layer shows when its back faces the viewer.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum BackfaceVisibility {
    #[default]
    Visible,
    Hidden,
}

impl BackfaceVisibility {
    pub fn is_visible(&self) -> bool {
        *self == Self::Visible
    }
}

pub fn multiply3(a: &Matrix3, b: &Matrix3) -> Matrix3 {
    let mut out = [[0.0; 3]; 3];
    for (r, row) in out.iter_mut().enumerate() {
        for (c, cell) in row.iter_mut().enumerate() {
            *cell = (0..3).map(|k| a[r][k] * b[k][c]).sum();
        }
    }
    out
}

/// `a · b` for a flat `b`, whose z row and column are the identity's (see
/// `EvaluatedTransform::is_flat`): what `multiply3` gives, in 12 products
/// instead of 27.
#[inline]
pub fn multiply3_flat(a: &Matrix3, b: &Matrix3) -> Matrix3 {
    a.map(|[x, y, z]| [x * b[0][0] + y * b[1][0], x * b[0][1] + y * b[1][1], z])
}

fn determinant3(m: &Matrix3) -> f64 {
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
}

/// The inverse, or `None` when `m` is singular or the result is not finite.
pub fn invert3(m: &Matrix3) -> Option<Matrix3> {
    let det = determinant3(m);
    if det == 0.0 || !det.is_finite() {
        return None;
    }
    let cofactor = |r: usize, c: usize| {
        let (r0, r1) = ((r + 1) % 3, (r + 2) % 3);
        let (c0, c1) = ((c + 1) % 3, (c + 2) % 3);
        m[r0][c0] * m[r1][c1] - m[r0][c1] * m[r1][c0]
    };
    let mut out = [[0.0; 3]; 3];
    for (r, row) in out.iter_mut().enumerate() {
        for (c, cell) in row.iter_mut().enumerate() {
            *cell = cofactor(c, r) / det;
        }
    }
    out.iter().flatten().all(|v| v.is_finite()).then_some(out)
}

/// Maps `(x, y)` through `m`, returning `[X/W, Y/W, W]`.
pub fn project(m: &Matrix3, x: f64, y: f64) -> [f64; 3] {
    let w = m[2][0] * x + m[2][1] * y + m[2][2];
    [
        (m[0][0] * x + m[0][1] * y + m[0][2]) / w,
        (m[1][0] * x + m[1][1] * y + m[1][2]) / w,
        w,
    ]
}

/// The largest singular value of the Jacobian of `(x, y) ↦ (X/W, Y/W)`: how
/// much the map stretches the plane at that point in its worst direction.
/// `None` where the point is at or behind the viewer (`W ≤ 0`) or the value is
/// not finite.
pub fn stretch_at(m: &Matrix3, x: f64, y: f64) -> Option<f64> {
    let [px, py, w] = project(m, x, y);
    if w <= 0.0 || !w.is_finite() {
        return None;
    }
    // d(X/W)/dv = (X_v − (X/W)·W_v) / W
    let jacobian = |row: usize, col: usize, p: f64| (m[row][col] - p * m[2][col]) / w;
    let (a, b) = (jacobian(0, 0, px), jacobian(0, 1, px));
    let (c, d) = (jacobian(1, 0, py), jacobian(1, 1, py));
    let frobenius = a * a + b * b + c * c + d * d;
    let det = a * d - b * c;
    let discriminant = (frobenius * frobenius - 4.0 * det * det).max(0.0);
    let stretch = ((frobenius + discriminant.sqrt()) / 2.0).sqrt();
    stretch.is_finite().then_some(stretch)
}

/// Whether the layer's back faces the viewer, given its accumulated linear
/// orientation (parent orientations times its own `linear()`). Compares the
/// sign of the z-axis cofactor against the determinant, so a mirroring scale
/// alone does not flip it; edge-on counts as front.
pub fn faces_away(orientation: &Matrix3) -> bool {
    let o = orientation;
    let det = determinant3(o);
    if !det.is_finite() || det.abs() <= EPSILON {
        return false;
    }
    let cofactor_zz = o[0][0] * o[1][1] - o[0][1] * o[1][0];
    cofactor_zz / det < 0.0
}

fn rotation_x(degrees: f64) -> Matrix3 {
    let (s, c) = degrees.to_radians().sin_cos();
    [[1.0, 0.0, 0.0], [0.0, c, -s], [0.0, s, c]]
}

fn rotation_y(degrees: f64) -> Matrix3 {
    let (s, c) = degrees.to_radians().sin_cos();
    [[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]]
}

fn rotation_z(degrees: f64) -> Matrix3 {
    let (s, c) = degrees.to_radians().sin_cos();
    [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]]
}

fn skew(angles: Point) -> Matrix3 {
    [
        [1.0, angles.x.to_radians().tan(), 0.0],
        [angles.y.to_radians().tan(), 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ]
}

impl EvaluatedTransform {
    /// The perspective distance, or `None` for an orthographic transform: a
    /// value that is not finite and positive means no perspective.
    pub fn perspective_distance(&self) -> Option<f64> {
        self.perspective.filter(|d| d.is_finite() && *d > 0.0)
    }

    /// Whether the transform only turns about the z axis and scales: no
    /// skew and no 3D rotation, so `linear` is `Rz · S` and flat (its z row
    /// and column are the identity's).
    #[inline]
    pub fn is_flat(&self) -> bool {
        self.skew.x == 0.0 && self.skew.y == 0.0 && self.rotation_x == 0.0 && self.rotation_y == 0.0
    }

    /// `Rx · Ry · Rz · K · S`: everything but position and perspective.
    /// A flat transform's is built directly, as it is for nearly every
    /// layer and particle of a frame.
    #[inline]
    pub fn linear(&self) -> Matrix3 {
        if !self.is_flat() {
            return self.linear_3d();
        }
        let (s, c) = if self.rotation == 0.0 {
            (0.0, 1.0)
        } else {
            self.rotation.to_radians().sin_cos()
        };
        let (x, y) = (self.scale.x, self.scale.y);
        [[c * x, -s * y, 0.0], [s * x, c * y, 0.0], [0.0, 0.0, 1.0]]
    }

    /// `linear` the long way, for any transform.
    pub(crate) fn linear_3d(&self) -> Matrix3 {
        let scale = [
            [self.scale.x, 0.0, 0.0],
            [0.0, self.scale.y, 0.0],
            [0.0, 0.0, 1.0],
        ];
        let mut m = multiply3(&skew(self.skew), &scale);
        m = multiply3(&rotation_z(self.rotation), &m);
        m = multiply3(&rotation_y(self.rotation_y), &m);
        multiply3(&rotation_x(self.rotation_x), &m)
    }

    /// The map from the layer plane (relative to its anchor) to the parent's
    /// plane, folding position and perspective into the linear part.
    pub fn homography(&self) -> Matrix3 {
        let l = self.linear();
        let (px, py) = (self.position.x, self.position.y);
        let inverse_distance = self.perspective_distance().map_or(0.0, |d| 1.0 / d);
        [
            [
                l[0][0] - px * l[2][0] * inverse_distance,
                l[0][1] - px * l[2][1] * inverse_distance,
                px,
            ],
            [
                l[1][0] - py * l[2][0] * inverse_distance,
                l[1][1] - py * l[2][1] * inverse_distance,
                py,
            ],
            [
                -l[2][0] * inverse_distance,
                -l[2][1] * inverse_distance,
                1.0,
            ],
        ]
    }

    /// Whether the transform needs a homography rather than an affine map.
    pub fn is_projective(&self) -> bool {
        let h = self.homography();
        h.iter().flatten().all(|v| v.is_finite()) && h[2][0].abs() + h[2][1].abs() > EPSILON
    }
}
