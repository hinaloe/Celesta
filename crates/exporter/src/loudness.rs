//! The last step of an export's mix: bringing it to the loudness target,
//! clipping it for the encoder, and measuring what is encoded.

use crate::control::AudioLoudness;
use celesta_media::{
    AudioBuffer, AudioMixError, LoudnessTarget, PeakHandling, TARGET_TOLERANCE_LU,
    measure_loudness, normalize_loudness,
};

/// Brings the unclipped `mix` to `target`, when there is one, clips it to
/// ±1, and measures it. Also returns a warning for each way the target
/// could not be met.
pub(crate) fn finish_mix(
    mix: &mut AudioBuffer,
    target: Option<&LoudnessTarget>,
    is_cancelled: impl FnMut() -> bool,
) -> Result<(AudioLoudness, Vec<String>), AudioMixError> {
    let mut warnings = Vec::new();
    let mut normalized = None;
    if let Some(target) = target {
        let (gain_db, loudness) = normalize_loudness(mix, target, is_cancelled)?;
        let wanted = target.integrated_lufs;
        match loudness.integrated_lufs {
            None => warnings.push(
                "the sound is silent or shorter than 0.4 s, so it has no loudness to bring to \
                 the target; it was written unchanged"
                    .to_owned(),
            ),
            Some(reached) if (reached - wanted).abs() > TARGET_TOLERANCE_LU => {
                warnings.push(match target.peak_handling {
                    PeakHandling::Lower => format!(
                        "the sound reaches {reached:.1} LUFS, not {wanted} LUFS: it was kept \
                         quieter so that its true peak stays at {} dBTP",
                        target.true_peak_dbtp
                    ),
                    PeakHandling::Limit => format!(
                        "the sound reaches {reached:.1} LUFS, not {wanted} LUFS, even with its \
                         peaks limited"
                    ),
                });
            }
            Some(_) => {}
        }
        normalized = Some((gain_db, loudness));
    }
    let mut clipped = false;
    for sample in &mut mix.samples {
        if sample.abs() > 1.0 {
            *sample = sample.clamp(-1.0, 1.0);
            clipped = true;
        }
    }
    // A normalized mix peaks under its ceiling, so clipping leaves it alone.
    let loudness = match normalized {
        Some((_, loudness)) if !clipped => loudness,
        _ => measure_loudness(mix),
    };
    Ok((
        AudioLoudness {
            integrated_lufs: loudness.integrated_lufs,
            true_peak_dbtp: loudness.true_peak_dbtp,
            gain_db: normalized.map(|(gain_db, _)| gain_db),
        },
        warnings,
    ))
}
