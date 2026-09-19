use crate::layout::{Align, Wrap};
use crate::{LayoutLine, ShapeLine, ShapeRunKey};

#[cfg(not(feature = "std"))]
use alloc::{rc::Rc, vec::Vec};
#[cfg(feature = "std")]
use std::rc::Rc;

/// Key for caching a fully built [`ShapeLine`] (word split + shaped runs).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ShapeLineKey {
    pub run: ShapeRunKey,
    pub tab_width: u16,
}

/// Helper structure for caching built shape lines.
#[derive(Clone, Default)]
pub struct ShapeLineCache {
    age: u64,
    cache: crate::HashMap<ShapeLineKey, (u64, Rc<ShapeLine>)>,
}

impl ShapeLineCache {
    /// Number of cached lines
    pub fn len(&self) -> usize {
        self.cache.len()
    }

    /// Whether no lines are cached
    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }

    /// Get cache item, updating age if found. The `Rc` clone keeps hits
    /// allocation-free; the shared line is never mutated afterwards.
    pub fn get(&mut self, key: &ShapeLineKey) -> Option<Rc<ShapeLine>> {
        self.cache.get_mut(key).map(|(age, line)| {
            *age = self.age;
            Rc::clone(line)
        })
    }

    /// Insert cache item with current age
    pub fn insert(&mut self, key: ShapeLineKey, line: Rc<ShapeLine>) {
        self.cache.insert(key, (self.age, line));
    }

    /// Remove anything in the cache with an age older than `keep_ages`
    pub fn trim(&mut self, keep_ages: u64) {
        self.cache
            .retain(|_key, (age, _line)| *age + keep_ages >= self.age);
        self.age += 1;
    }
}

impl core::fmt::Debug for ShapeLineCache {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_tuple("ShapeLineCache").finish()
    }
}

/// Key for caching laid out lines: everything [`crate::BufferLine::layout`]
/// feeds into `layout_to_buffer`.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct LayoutRunKey {
    pub line: ShapeRunKey,
    pub font_size_bits: u32,
    pub width_bits: Option<u32>,
    pub wrap: Wrap,
    pub align: Option<Align>,
    pub match_mono_bits: Option<u32>,
    pub tab_width: u16,
}

/// Helper structure for caching laid out lines.
#[derive(Clone, Default)]
pub struct LayoutRunCache {
    age: u64,
    cache: crate::HashMap<LayoutRunKey, (u64, Rc<Vec<LayoutLine>>)>,
}

impl LayoutRunCache {
    /// Number of cached line layouts
    pub fn len(&self) -> usize {
        self.cache.len()
    }

    /// Whether no line layouts are cached
    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }

    /// Get cache item, updating age if found. The `Rc` clone keeps hits
    /// allocation-free; the shared layout is never mutated afterwards.
    pub fn get(&mut self, key: &LayoutRunKey) -> Option<Rc<Vec<LayoutLine>>> {
        self.cache.get_mut(key).map(|(age, layout)| {
            *age = self.age;
            Rc::clone(layout)
        })
    }

    /// Insert cache item with current age
    pub fn insert(&mut self, key: LayoutRunKey, layout: Rc<Vec<LayoutLine>>) {
        self.cache.insert(key, (self.age, layout));
    }

    /// Remove anything in the cache with an age older than `keep_ages`
    pub fn trim(&mut self, keep_ages: u64) {
        self.cache
            .retain(|_key, (age, _layout)| *age + keep_ages >= self.age);
        self.age += 1;
    }
}

impl core::fmt::Debug for LayoutRunCache {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_tuple("LayoutRunCache").finish()
    }
}
