#[cfg(not(feature = "std"))]
use alloc::{string::String, vec::Vec};
use core::cmp::{max, min};
use core::ops::Range;

use crate::{AttrsList, AttrsOwned, HashMap, ShapeGlyph};

/// Diagnostic hit/miss counters for [`ShapeRunCache`] (OBSCURA_RENDER_TIMING).
#[cfg(feature = "std")]
pub static SHAPE_RUN_HITS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
#[cfg(feature = "std")]
pub static SHAPE_RUN_MISSES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// (hits, misses) of the shaped-run cache since process start.
#[cfg(feature = "std")]
pub fn shape_run_cache_stats() -> (u64, u64) {
    use std::sync::atomic::Ordering::Relaxed;
    (
        SHAPE_RUN_HITS.load(Relaxed),
        SHAPE_RUN_MISSES.load(Relaxed),
    )
}

/// Key for caching shape runs.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ShapeRunKey {
    pub text: String,
    pub default_attrs: AttrsOwned,
    pub attrs_spans: Vec<(Range<usize>, AttrsOwned)>,
}

impl ShapeRunKey {
    /// Build the cache key for one run of `line` with `attrs_list`.
    pub fn new(line: &str, attrs_list: &AttrsList, start_run: usize, end_run: usize) -> Self {
        let run_range = start_run..end_run;
        let mut key = ShapeRunKey {
            text: line[run_range.clone()].to_string(),
            default_attrs: AttrsOwned::new(&attrs_list.defaults()),
            attrs_spans: Vec::new(),
        };
        for (attrs_range, attrs) in attrs_list.spans.overlapping(&run_range) {
            if attrs == &key.default_attrs {
                // Skip if attrs matches default attrs
                continue;
            }
            let start = max(attrs_range.start, start_run).saturating_sub(start_run);
            let end = min(attrs_range.end, end_run).saturating_sub(start_run);
            if end > start {
                let range = start..end;
                key.attrs_spans.push((range, attrs.clone()));
            }
        }
        key
    }
}

/// A helper structure for caching shape runs.
#[derive(Clone, Default)]
pub struct ShapeRunCache {
    age: u64,
    cache: HashMap<ShapeRunKey, (u64, Vec<ShapeGlyph>)>,
}

impl ShapeRunCache {
    /// Number of cached runs
    pub fn len(&self) -> usize {
        self.cache.len()
    }

    /// Whether no runs are cached
    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }

    /// Get cache item, updating age if found
    pub fn get(&mut self, key: &ShapeRunKey) -> Option<&Vec<ShapeGlyph>> {
        self.cache.get_mut(key).map(|(age, glyphs)| {
            *age = self.age;
            &*glyphs
        })
    }

    /// Insert cache item with current age
    pub fn insert(&mut self, key: ShapeRunKey, glyphs: Vec<ShapeGlyph>) {
        self.cache.insert(key, (self.age, glyphs));
    }

    /// Remove anything in the cache with an age older than `keep_ages`
    pub fn trim(&mut self, keep_ages: u64) {
        self.cache
            .retain(|_key, (age, _glyphs)| *age + keep_ages >= self.age);
        // Increase age
        self.age += 1;
    }
}

impl core::fmt::Debug for ShapeRunCache {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_tuple("ShapeRunCache").finish()
    }
}
