use crate::bounds::{CanvasRegion, PixelBounds};
use crate::effect::EffectSpec;
use crate::layer::PreparedItem;
use crate::mask::MaskSpec;
use crate::plane::projected_bounds;
use crate::texture::LayerTexture;
use celesta_composition::BlendMode;

/// A frame's draws, ready to encode: the buffer holding every layer's
/// instance, and what to draw with them in painter's order.
pub(crate) struct PreparedDraws {
    pub(crate) instances: wgpu::Buffer,
    /// The bind group exposing the frame's clips to the fragment shader.
    pub(crate) clips: wgpu::BindGroup,
    /// Only `GpuStep::Draw`s unless `composite` is set.
    pub(crate) steps: Vec<GpuStep>,
    pub(crate) composite: Option<CompositePlan>,
}

/// How a frame that uses blend modes composites through canvases.
pub(crate) struct CompositePlan {
    /// The instance that copies the root canvas onto the target.
    pub(crate) blit_instance: u32,
}

/// The canvas an isolated group, an effect, a mask and its group's
/// children, or a plane draw their layers onto.
#[derive(Clone, Copy)]
pub(crate) struct GroupPlan {
    pub(crate) canvas: CanvasRegion,
    /// What the group's layers cover, in the pixels of the space it is drawn
    /// in (the scene's, or an enclosing plane's).
    pub(crate) content: Option<PixelBounds>,
    /// The box of the group's layers' shapes, in those pixels: `content`
    /// without the margins added for filtering and rounding.
    pub(crate) shape: Option<PixelBounds>,
    /// Whether anything of the group (or its effect) reaches the scene.
    /// When not, its layers still draw onto `canvas`, a single pixel none
    /// of them can touch, and the group draws nothing onto its parent.
    pub(crate) drawn: bool,
    /// Where the group's canvas lands in its parent's space: the canvas's
    /// own region, or a plane's canvas projected; `None` when it lands
    /// nowhere.
    pub(crate) lands: Option<PixelBounds>,
}

impl GroupPlan {
    /// The pixels of `target`, its parent's canvas, that the group's canvas
    /// covers; `None` when it draws nothing there.
    pub(crate) fn area(&self, target: CanvasRegion) -> Option<[u32; 4]> {
        self.drawn
            .then(|| self.lands.and_then(|lands| target.local_area(lands)))
            .flatten()
    }
}

/// Plans the canvas of every isolated group, effect, mask, and plane in
/// `items`, in the order they begin, from the bounds of what their layers
/// draw. A mask's canvas covers where its children show through it; a
/// plane's is its own size, and the canvases inside it are in its pixels.
pub(crate) fn plan_groups(items: &[PreparedItem], scene: CanvasRegion) -> Vec<GroupPlan> {
    walk_groups(items, scene, |_| {
        unreachable!("pending text and paths are resolved")
    })
    .0
}

/// What `items` (in one space, with text and paths possibly still pending)
/// cover: the bounds the plans of `plan_groups` grow from, so nested groups,
/// masks, effects, and planes count as they would be drawn. `pending`
/// measures the pending item at an index of `items`.
pub(crate) fn content_bounds(
    items: &[PreparedItem],
    pending: impl Fn(usize) -> Option<PixelBounds>,
) -> Option<PixelBounds> {
    // The canvases planned on the way are dropped, so any space will do.
    let space = CanvasRegion::scene(1, 1);
    walk_groups(items, space, |index| {
        let bounds = pending(index);
        Covered {
            content: bounds,
            shape: bounds,
        }
    })
    .1
    .content
}

/// `plan_groups`, which also returns what `items` cover as a whole, and
/// measures pending items with `pending`.
fn walk_groups(
    items: &[PreparedItem],
    scene: CanvasRegion,
    pending: impl Fn(usize) -> Covered,
) -> (Vec<GroupPlan>, Covered) {
    let mut plans: Vec<GroupPlan> = Vec::new();
    // Each open group's index in `plans` and what its layers cover so far,
    // after what the items outside any group cover.
    let mut open: Vec<(usize, Covered)> = vec![(usize::MAX, Covered::default())];
    // What each open mask drew, once its group's children have begun.
    let mut masks: Vec<Covered> = Vec::new();
    // The space each open group's canvas is clamped to: the scene, or the
    // innermost open plane.
    let mut spaces = vec![scene];
    let cover = |open: &mut Vec<(usize, Covered)>, bounds: Covered| {
        let (_, covered) = open.last_mut().expect("the outermost items are open");
        *covered = covered.union(bounds);
    };
    let plan = |covered: Covered, output: Option<PixelBounds>, space: CanvasRegion| {
        let canvas = CanvasRegion::covering(output, space);
        GroupPlan {
            canvas: canvas.unwrap_or(CanvasRegion {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            }),
            content: covered.content,
            shape: covered.shape,
            drawn: canvas.is_some(),
            lands: canvas.map(CanvasRegion::bounds),
        }
    };
    for (index, item) in items.iter().enumerate() {
        let space = *spaces.last().expect("the scene is always open");
        match item {
            PreparedItem::Layer(layer) => cover(
                &mut open,
                Covered {
                    content: Some(layer.bounds()),
                    shape: Some(layer.shape()),
                },
            ),
            PreparedItem::Instances(instances) => cover(
                &mut open,
                Covered {
                    content: Some(instances.bounds()),
                    shape: Some(instances.shape()),
                },
            ),
            PreparedItem::PendingText | PreparedItem::PendingPath => {
                cover(&mut open, pending(index));
            }
            PreparedItem::BeginGroup | PreparedItem::BeginMask | PreparedItem::BeginAverage => {
                open.push((plans.len(), Covered::default()));
                plans.push(plan(Covered::default(), None, space));
            }
            PreparedItem::BeginPlane { width, height } => {
                let canvas = CanvasRegion::scene(*width, *height);
                open.push((plans.len(), Covered::default()));
                plans.push(GroupPlan {
                    canvas,
                    content: None,
                    shape: None,
                    drawn: true,
                    lands: None,
                });
                spaces.push(canvas);
            }
            // Every sample draws onto a canvas covering what any of them
            // covers.
            PreparedItem::NextSample => {}
            PreparedItem::MaskContent => {
                let (index, mask) = open.pop().expect("every mask was begun");
                masks.push(mask);
                open.push((index, Covered::default()));
            }
            PreparedItem::EndMask(_, spec) => {
                let (index, children) = open.pop().expect("every mask was begun");
                let mask = masks.pop().expect("every mask has content");
                // Inverted, the children show wherever the mask is not
                // drawn, which can be anywhere they are.
                let shown = if spec.invert {
                    children
                } else {
                    Covered {
                        content: PixelBounds::intersection(children.content, mask.content),
                        shape: PixelBounds::intersection(children.shape, mask.shape),
                    }
                };
                plans[index] = plan(shown, shown.content, space);
                cover(&mut open, shown);
            }
            PreparedItem::EndGroup(_) | PreparedItem::EndAverage(_) => {
                let (index, covered) = open.pop().expect("every group was begun");
                plans[index] = plan(covered, covered.content, space);
                cover(&mut open, covered);
            }
            PreparedItem::EndEffect(_, effects) => {
                let (index, covered) = open.pop().expect("every group was begun");
                let output = covered
                    .content
                    .map(|content| effects.output_bounds(content));
                plans[index] = plan(covered, output, space);
                // A blur or a shadow spreads the pixels, not the shape.
                cover(
                    &mut open,
                    Covered {
                        content: output,
                        shape: covered.shape,
                    },
                );
            }
            PreparedItem::EndPlane(layer) => {
                let (index, covered) = open.pop().expect("every plane was begun");
                let plane = spaces.pop().expect("every plane was begun");
                let lands = projected_bounds(&layer.map(), plane.width, plane.height);
                plans[index].content = covered.content;
                plans[index].shape = covered.shape;
                plans[index].lands = lands;
                cover(
                    &mut open,
                    Covered {
                        content: lands,
                        shape: lands,
                    },
                );
            }
        }
    }
    let (_, covered) = open.pop().expect("the outermost items are open");
    (plans, covered)
}

/// What a group's layers cover so far: `GroupPlan::content` and `shape`.
#[derive(Clone, Copy, Default)]
struct Covered {
    content: Option<PixelBounds>,
    shape: Option<PixelBounds>,
}

impl Covered {
    fn union(self, other: Self) -> Self {
        Self {
            content: PixelBounds::union(self.content, other.content),
            shape: PixelBounds::union(self.shape, other.shape),
        }
    }
}

pub(crate) enum GpuStep {
    /// A run of instances that sample the same texture, drawn source-over.
    Draw(GpuDraw),
    /// One instance blended onto the current canvas through `blend_mode`.
    Blend {
        draw: GpuDraw,
        blend_mode: BlendMode,
        /// The canvas pixels the draw can change, `[x, y, width, height]`;
        /// `None` when it misses the canvas.
        area: Option<[u32; 4]>,
    },
    /// Starts drawing onto a fresh transparent canvas covering `canvas`.
    BeginGroup {
        canvas: CanvasRegion,
    },
    /// Draws the finished group canvas onto its parent with `instance`.
    EndGroup {
        instance: u32,
        blend_mode: BlendMode,
        /// The parent canvas pixels the group's canvas covers; `None` when
        /// it draws nothing there.
        area: Option<[u32; 4]>,
    },
    EndEffect {
        inner_instance: u32,
        final_instance: u32,
        blend_mode: BlendMode,
        effects: EffectSpec,
        /// The part of the effect's canvas its layers drew on, in that
        /// canvas's pixels; `None` when they drew nothing.
        content: Option<PixelBounds>,
        /// The box of its layers' shapes, in scene pixels: the content box
        /// a custom shader sees.
        shape: Option<PixelBounds>,
        /// As for `EndGroup`.
        area: Option<[u32; 4]>,
    },
    /// Starts drawing a mask onto a fresh transparent canvas covering
    /// `canvas`; the steps from the matching `MaskContent` draw the group's
    /// children onto a second one covering the same region.
    BeginMask {
        canvas: CanvasRegion,
    },
    /// Ends the mask's steps; the children's follow, onto the second canvas.
    MaskContent,
    /// Draws the children shown through the mask onto the parent with
    /// `instance`.
    EndMask {
        instance: u32,
        blend_mode: BlendMode,
        mask: MaskSpec,
        /// As for `EndGroup`.
        area: Option<[u32; 4]>,
    },
    /// Starts a motion-blurred group: the steps up to the first
    /// `NextSample`, and those between it and the next, draw each sample
    /// onto a fresh transparent canvas covering `canvas`, and the group's
    /// canvas holds their average.
    BeginAverage {
        canvas: CanvasRegion,
    },
    NextSample,
    /// Draws the averaged samples onto the parent with `instance`.
    EndAverage {
        instance: u32,
        blend_mode: BlendMode,
        /// As for `EndGroup`.
        area: Option<[u32; 4]>,
    },
}

/// The size of backdrop the blended draws among `steps` need, at least the
/// `scene`'s: a blended draw copies what is beneath it into the backdrop at
/// the same place, so the backdrop covers every canvas one draws onto. Only
/// a plane's canvas can be larger than the scene; past it, the backdrop is
/// sized in `CanvasRegion::STEP`s (at most `limit`), so a plane that grows a
/// little does not reallocate it.
pub(crate) fn backdrop_size(steps: &[GpuStep], scene: (u32, u32), limit: u32) -> (u32, u32) {
    let mut size = scene;
    let mut cover = |(width, height): (u32, u32)| {
        let step = |extent: u32, scene: u32| {
            if extent <= scene {
                scene
            } else {
                (extent.div_ceil(CanvasRegion::STEP) * CanvasRegion::STEP)
                    .min(limit)
                    .max(extent)
            }
        };
        size = (
            size.0.max(step(width, scene.0)),
            size.1.max(step(height, scene.1)),
        );
    };
    // The size of each open canvas, the root first.
    let mut open = vec![scene];
    for step in steps {
        match step {
            GpuStep::BeginGroup { canvas }
            | GpuStep::BeginMask { canvas }
            | GpuStep::BeginAverage { canvas } => open.push((canvas.width, canvas.height)),
            GpuStep::Blend { .. } => cover(*open.last().expect("the root is always open")),
            GpuStep::EndGroup { blend_mode, .. }
            | GpuStep::EndEffect { blend_mode, .. }
            | GpuStep::EndMask { blend_mode, .. }
            | GpuStep::EndAverage { blend_mode, .. } => {
                open.pop();
                if !blend_mode.is_normal() {
                    cover(*open.last().expect("the root is always open"));
                }
            }
            GpuStep::Draw(_) | GpuStep::MaskContent | GpuStep::NextSample => {}
        }
    }
    size
}

pub(crate) struct GpuDraw {
    pub(crate) texture: LayerTexture,
    /// `0..6` (one quad) except for a path, which draws a quad per tile it
    /// covers.
    pub(crate) vertices: std::ops::Range<u32>,
    pub(crate) instances: std::ops::Range<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn begin(width: u32, height: u32) -> GpuStep {
        GpuStep::BeginGroup {
            canvas: CanvasRegion::scene(width, height),
        }
    }

    fn end(blend_mode: BlendMode) -> GpuStep {
        GpuStep::EndGroup {
            instance: 0,
            blend_mode,
            area: None,
        }
    }

    #[test]
    fn an_unblended_oversized_plane_needs_no_larger_backdrop() {
        let steps = [begin(4000, 3000), end(BlendMode::Normal)];
        assert_eq!(backdrop_size(&steps, (1920, 1080), 8192), (1920, 1080));
    }

    #[test]
    fn a_blend_inside_an_oversized_plane_grows_the_backdrop_in_steps() {
        let steps = [
            begin(4000, 1000),
            begin(64, 64),
            end(BlendMode::Difference),
            end(BlendMode::Normal),
        ];
        assert_eq!(backdrop_size(&steps, (1920, 1080), 8192), (4096, 1080));
    }

    #[test]
    fn a_blended_plane_needs_only_its_parents_backdrop() {
        let steps = [begin(4000, 3000), end(BlendMode::Multiply)];
        assert_eq!(backdrop_size(&steps, (1920, 1080), 8192), (1920, 1080));
    }
}
