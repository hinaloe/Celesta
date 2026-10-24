//! A layer's geometry for the canvas tools: the map from its own pixels to
//! its parent's space, built with the same functions the renderer places it
//! with, the box it covers in its own pixels, and the position that keeps a
//! chosen point still through a change of its other transform props.
//!
//! A layer's own pixels are relative to its anchor point, as
//! `EvaluatedTransform::homography` lays the layer plane out.

// The pivot and resize tools take these up; until then only the tests do.
#![cfg_attr(not(test), allow(dead_code))]

use celesta_composition::{EvaluatedTransform, Point};
use celesta_gpu_renderer::{LayerFrame, invert_affine};

/// The layer's box in its own pixels, relative to its anchor point.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct LocalBox {
    pub(crate) min: Point,
    pub(crate) max: Point,
}

impl LocalBox {
    pub(crate) fn size(&self) -> Point {
        Point {
            x: self.max.x - self.min.x,
            y: self.max.y - self.min.y,
        }
    }

    pub(crate) fn center(&self) -> Point {
        self.at(0.5, 0.5)
    }

    /// The point at fractions (`fx`, `fy`) of the box (0,0 top-left, 1,1 bottom-right).
    pub(crate) fn at(&self, fx: f64, fy: f64) -> Point {
        let size = self.size();
        Point {
            x: self.min.x + fx * size.x,
            y: self.min.y + fy * size.y,
        }
    }
}

/// The layer's own-pixel → parent map for `transform`: `[a, b, c, d, tx, ty]`
/// built from `EvaluatedTransform::linear` and `translation` (2D part).
pub(crate) fn layer_map(transform: &EvaluatedTransform) -> [f64; 6] {
    let linear = transform.linear();
    let translation = transform.translation(&linear);
    [
        linear[0][0],
        linear[1][0],
        linear[0][1],
        linear[1][1],
        translation.x,
        translation.y,
    ]
}

/// The pivot in parent space: where `translation` puts the turning point.
pub(crate) fn pivot(transform: &EvaluatedTransform) -> Point {
    apply(&layer_map(transform), transform.origin)
}

/// The box `frame.outline` encloses, in the layer's own pixels; `None` when a map collapses.
pub(crate) fn local_box(frame: &LayerFrame) -> Option<LocalBox> {
    let parent = invert_affine(frame.parent)?;
    let layer = invert_affine(layer_map(&frame.transform))?;
    let corners = frame
        .outline
        .map(|corner| apply(&layer, apply(&parent, corner)));
    let fold = |pick: fn(f64, f64) -> f64| Point {
        x: corners.iter().map(|p| p.x).reduce(pick).unwrap_or_default(),
        y: corners.iter().map(|p| p.y).reduce(pick).unwrap_or_default(),
    };
    Some(LocalBox {
        min: fold(f64::min),
        max: fold(f64::max),
    })
}

/// `position` that keeps `fixed_parent` where it is once the layer's props
/// become `after` (with `after.position` still the old position) and the fixed
/// point sits at `fixed_local` in the new own pixels.
pub(crate) fn keep_fixed(
    after: &EvaluatedTransform,
    fixed_local: Point,
    fixed_parent: Point,
) -> Point {
    // The map moves by exactly what `position` moves by, so the miss is the
    // change.
    let missed = apply(&layer_map(after), fixed_local);
    Point {
        x: after.position.x + fixed_parent.x - missed.x,
        y: after.position.y + fixed_parent.y - missed.y,
    }
}

/// `m` applied to `p` (`x' = a x + c y + tx`).
fn apply(m: &[f64; 6], p: Point) -> Point {
    Point {
        x: m[0] * p.x + m[2] * p.y + m[4],
        y: m[1] * p.x + m[3] * p.y + m[5],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    fn assert_near(actual: Point, expected: Point) {
        assert!(
            (actual.x - expected.x).abs() < 1e-9 && (actual.y - expected.y).abs() < 1e-9,
            "{actual:?} != {expected:?}"
        );
    }

    /// `m` applied to `p`, written out here so the tests do not lean on the
    /// module's own helper.
    fn map(m: [f64; 6], p: Point) -> Point {
        at(
            m[0] * p.x + m[2] * p.y + m[4],
            m[1] * p.x + m[3] * p.y + m[5],
        )
    }

    /// The frame of a `width` × `height` box placed by `transform` inside
    /// `parent`: its outline is the box's corners, relative to the anchor
    /// point as the renderer lays a quad out, mapped to the scene.
    fn frame(
        transform: EvaluatedTransform,
        parent: [f64; 6],
        width: f64,
        height: f64,
    ) -> LayerFrame {
        let anchor = transform.anchor;
        let (s, c) = transform.rotation.to_radians().sin_cos();
        let Point { x: sx, y: sy } = transform.scale;
        // Only rotation, scale and position, with no origin: `layer_map`'s
        // layout written out by hand.
        let own = [
            c * sx,
            s * sx,
            -s * sy,
            c * sy,
            transform.position.x,
            transform.position.y,
        ];
        let outline = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)].map(|(u, v)| {
            let local = at((u - anchor.x) * width, (v - anchor.y) * height);
            map(parent, map(own, local))
        });
        LayerFrame {
            transform,
            parent,
            outline,
            leaves: vec!["a".to_owned()],
        }
    }

    #[test]
    fn layer_map_matches_the_renderer_layout() {
        let transform = EvaluatedTransform {
            position: at(100.0, 50.0),
            rotation: 90.0,
            scale: at(2.0, 1.0),
            ..EvaluatedTransform::default()
        };
        assert_near(map(layer_map(&transform), at(10.0, 0.0)), at(100.0, 70.0));
        assert_near(pivot(&transform), at(100.0, 50.0));

        let with_origin = EvaluatedTransform {
            origin: at(5.0, 0.0),
            ..transform
        };
        assert_near(pivot(&with_origin), at(105.0, 50.0));
        assert_near(map(layer_map(&with_origin), at(5.0, 0.0)), at(105.0, 50.0));
    }

    #[test]
    fn local_box_reads_the_outline() {
        let parent = [2.0, 0.0, 0.0, 2.0, 7.0, -3.0];
        let centered = EvaluatedTransform {
            position: at(40.0, 30.0),
            rotation: 30.0,
            ..EvaluatedTransform::default()
        };
        let local = local_box(&frame(centered, parent, 200.0, 100.0)).expect("a box");
        assert_near(local.size(), at(200.0, 100.0));
        assert_near(local.center(), at(0.0, 0.0));
        assert_near(local.min, at(-100.0, -50.0));
        assert_near(local.at(1.0, 0.5), at(100.0, 0.0));

        let top_left = EvaluatedTransform {
            anchor: at(0.0, 0.0),
            ..centered
        };
        let local = local_box(&frame(top_left, parent, 200.0, 100.0)).expect("a box");
        assert_near(local.min, at(0.0, 0.0));
        assert_near(local.max, at(200.0, 100.0));
    }

    #[test]
    fn a_collapsed_map_has_no_local_box() {
        let flat = EvaluatedTransform {
            scale: at(0.0, 1.0),
            ..EvaluatedTransform::default()
        };
        let mut collapsed = frame(flat, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0], 10.0, 10.0);
        assert_eq!(local_box(&collapsed), None);
        collapsed.transform = EvaluatedTransform::default();
        collapsed.parent = [1.0, 2.0, 2.0, 4.0, 0.0, 0.0];
        assert_eq!(local_box(&collapsed), None);
    }

    #[test]
    fn keeping_the_center_through_a_rotation() {
        let before = EvaluatedTransform {
            position: at(10.0, 10.0),
            anchor: at(0.0, 0.0),
            ..EvaluatedTransform::default()
        };
        let after = EvaluatedTransform {
            rotation: 90.0,
            ..before
        };
        // Under no parent and under one rotated 45° and scaled 2: the fixed
        // point is in parent space, so the parent cancels.
        let (sin, cos) = 45.0_f64.to_radians().sin_cos();
        for parent in [
            [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            [2.0 * cos, 2.0 * sin, -2.0 * sin, 2.0 * cos, 30.0, -20.0],
        ] {
            let local = local_box(&frame(before, parent, 100.0, 50.0)).expect("a box");
            let center = local.center();
            assert_near(center, at(50.0, 25.0));
            let fixed_parent = map(layer_map(&before), center);
            assert_near(fixed_parent, at(60.0, 35.0));

            let position = keep_fixed(&after, center, fixed_parent);
            // M'(c) = (10 − 25, 10 + 50) = (−15, 60), so the layer moves by
            // (60 − (−15), 35 − 60).
            assert_near(position, at(85.0, -15.0));
            let moved = EvaluatedTransform { position, ..after };
            assert_near(
                map(parent, map(layer_map(&moved), center)),
                map(parent, map(layer_map(&before), center)),
            );
        }
    }

    #[test]
    fn keeping_a_point_with_skew_and_origin() {
        let before = EvaluatedTransform {
            position: at(30.0, 20.0),
            skew: at(20.0, 0.0),
            origin: at(40.0, 0.0),
            ..EvaluatedTransform::default()
        };
        let after = EvaluatedTransform {
            scale: at(1.5, 0.8),
            ..before
        };
        let fixed_local = at(-50.0, 25.0);
        let fixed_parent = map(layer_map(&before), fixed_local);

        let position = keep_fixed(&after, fixed_local, fixed_parent);
        assert!(
            (position.x - before.position.x).abs() > 1.0,
            "the scale moves the point, so the position compensates: {position:?}"
        );
        let moved = EvaluatedTransform { position, ..after };
        assert_near(map(layer_map(&moved), fixed_local), fixed_parent);
    }
}
