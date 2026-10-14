//! Where each leaf layer of a frame was drawn, so a point in the scene can
//! be mapped back to the topmost layer under it.

use celesta_composition::Point;

/// A leaf layer's quad in scene pixels and the clips it was drawn through.
#[derive(Clone, Debug, PartialEq)]
pub struct HitRegion {
    pub layer_id: String,
    /// The quad's corners in order around it: the ones that were its
    /// top-left, top-right, bottom-right and bottom-left before the layer's
    /// transform. A path's and an `Instances` layer's are those of the box
    /// around their shapes.
    pub corners: [Point; 4],
    /// Every clip the layer is drawn through, innermost first.
    pub clips: Vec<HitClip>,
}

/// One clipped group, as `ClipEntry` describes it to the fragment shader.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HitClip {
    /// Maps a scene position into the group's frame, relative to the clip
    /// rectangle's centre.
    pub(crate) inverse: [f32; 6],
    pub(crate) half: [f32; 2],
    pub(crate) radius: f32,
}

impl HitClip {
    /// Whether `point`, in scene pixels, is inside the clip: the rounded box
    /// `clip_coverage` in `layer.wgsl` measures, its edge counted inside.
    pub fn contains(&self, point: Point) -> bool {
        let [a, b, c, d, tx, ty] = self.inverse.map(f64::from);
        let local = [
            a * point.x + c * point.y + tx,
            b * point.x + d * point.y + ty,
        ];
        let radius = f64::from(self.radius);
        let [qx, qy] = [0, 1].map(|axis| local[axis].abs() - f64::from(self.half[axis]) + radius);
        let distance = qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - radius;
        distance <= 0.0
    }
}

impl HitRegion {
    /// Whether `point`, in scene pixels, is inside the quad and every clip.
    fn contains(&self, point: Point) -> bool {
        // Inside a convex quad, the point is on the same side of every edge,
        // whichever way round a mirroring transform turned the corners.
        let sides = [0, 1, 2, 3].map(|i| {
            let (from, to) = (self.corners[i], self.corners[(i + 1) % 4]);
            (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x)
        });
        (sides.iter().all(|side| *side >= 0.0) || sides.iter().all(|side| *side <= 0.0))
            && self.clips.iter().all(|clip| clip.contains(point))
    }
}

/// A leaf layer `prepare_layer` met while recording, whose corners are
/// known once its item is resolved.
pub(crate) struct HitLeaf {
    /// Index of its item (an `Instances` layer's particles) in the frame's
    /// items, before `prepare_draws` drops the paths that cover no pixel.
    pub(crate) item: usize,
    pub(crate) layer_id: String,
    /// The innermost clip the layer is drawn through.
    pub(crate) clip: Option<u32>,
}

/// The id of the topmost region containing `point`: regions are in
/// painter's order, so the last one.
pub fn hit_test(regions: &[HitRegion], point: Point) -> Option<&str> {
    regions
        .iter()
        .rev()
        .find(|region| region.contains(point))
        .map(|region| region.layer_id.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region(id: &str, corners: [(f64, f64); 4]) -> HitRegion {
        HitRegion {
            layer_id: id.to_owned(),
            corners: corners.map(|(x, y)| Point { x, y }),
            clips: Vec::new(),
        }
    }

    fn square(id: &str) -> HitRegion {
        region(id, [(10.0, 10.0), (20.0, 10.0), (20.0, 20.0), (10.0, 20.0)])
    }

    #[test]
    fn hits_a_square_only_inside_it() {
        let regions = [square("square")];
        assert_eq!(
            hit_test(&regions, Point { x: 15.0, y: 15.0 }),
            Some("square")
        );
        assert_eq!(hit_test(&regions, Point { x: 25.0, y: 15.0 }), None);
    }

    #[test]
    fn hits_a_rotated_square_by_its_own_edges() {
        // The square above, turned 45° about its centre: a diamond.
        let (centre, reach) = (15.0, 5.0 * std::f64::consts::SQRT_2);
        let regions = [region(
            "diamond",
            [
                (centre, centre - reach),
                (centre + reach, centre),
                (centre, centre + reach),
                (centre - reach, centre),
            ],
        )];
        assert_eq!(
            hit_test(&regions, Point { x: 15.0, y: 9.0 }),
            Some("diamond")
        );
        // Inside the square's box, outside the diamond.
        assert_eq!(hit_test(&regions, Point { x: 11.0, y: 11.0 }), None);
    }

    #[test]
    fn hits_the_later_of_two_overlapping_regions() {
        let regions = [square("below"), square("above")];
        assert_eq!(
            hit_test(&regions, Point { x: 15.0, y: 15.0 }),
            Some("above")
        );
    }

    #[test]
    fn misses_a_region_outside_its_clip() {
        let mut clipped = square("clipped");
        // The left half of the square: (10,10)-(15,20).
        clipped.clips.push(HitClip {
            inverse: [1.0, 0.0, 0.0, 1.0, -12.5, -15.0],
            half: [2.5, 5.0],
            radius: 0.0,
        });
        let regions = [clipped];
        assert_eq!(
            hit_test(&regions, Point { x: 12.0, y: 15.0 }),
            Some("clipped")
        );
        assert_eq!(hit_test(&regions, Point { x: 17.0, y: 15.0 }), None);
    }

    #[test]
    fn misses_without_regions() {
        assert_eq!(hit_test(&[], Point { x: 15.0, y: 15.0 }), None);
    }
}
