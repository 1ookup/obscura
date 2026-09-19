#[cfg(not(feature = "std"))]
use alloc::{string::String, vec::Vec};
use core::mem;

#[cfg(not(feature = "std"))]
use alloc::rc::Rc;
#[cfg(feature = "std")]
use std::rc::Rc;

use crate::{
    Align, Attrs, AttrsList, Cached, FontSystem, LayoutLine, LineEnding, ShapeLine, Shaping, Wrap,
};

/// A line (or paragraph) of text that is shaped and laid out
#[derive(Clone, Debug)]
pub struct BufferLine {
    text: String,
    ending: LineEnding,
    attrs_list: AttrsList,
    align: Option<Align>,
    shape_opt: Cached<Rc<ShapeLine>>,
    layout_opt: Cached<Rc<Vec<LayoutLine>>>,
    shaping: Shaping,
    metadata: Option<usize>,
}

impl BufferLine {
    /// Create a new line with the given text and attributes list
    /// Cached shaping and layout can be done using the [`Self::shape`] and
    /// [`Self::layout`] functions
    pub fn new<T: Into<String>>(
        text: T,
        ending: LineEnding,
        attrs_list: AttrsList,
        shaping: Shaping,
    ) -> Self {
        Self {
            text: text.into(),
            ending,
            attrs_list,
            align: None,
            shape_opt: Cached::Empty,
            layout_opt: Cached::Empty,
            shaping,
            metadata: None,
        }
    }

    /// Resets the current line with new internal values.
    ///
    /// Avoids deallocating internal caches so they can be reused.
    pub fn reset_new<T: Into<String>>(
        &mut self,
        text: T,
        ending: LineEnding,
        attrs_list: AttrsList,
        shaping: Shaping,
    ) {
        self.text = text.into();
        self.ending = ending;
        self.attrs_list = attrs_list;
        self.align = None;
        self.shape_opt.set_unused();
        self.layout_opt.set_unused();
        self.shaping = shaping;
        self.metadata = None;
    }

    /// Get current text
    pub fn text(&self) -> &str {
        &self.text
    }

    /// Set text and attributes list
    ///
    /// Will reset shape and layout if it differs from current text and attributes list.
    /// Returns true if the line was reset
    pub fn set_text<T: AsRef<str>>(
        &mut self,
        text: T,
        ending: LineEnding,
        attrs_list: AttrsList,
    ) -> bool {
        let text = text.as_ref();
        if text != self.text || ending != self.ending || attrs_list != self.attrs_list {
            self.text.clear();
            self.text.push_str(text);
            self.ending = ending;
            self.attrs_list = attrs_list;
            self.reset();
            true
        } else {
            false
        }
    }

    /// Consume this line, returning only its text contents as a String.
    pub fn into_text(self) -> String {
        self.text
    }

    /// Get line ending
    pub fn ending(&self) -> LineEnding {
        self.ending
    }

    /// Set line ending
    ///
    /// Will reset shape and layout if it differs from current line ending.
    /// Returns true if the line was reset
    pub fn set_ending(&mut self, ending: LineEnding) -> bool {
        if ending != self.ending {
            self.ending = ending;
            self.reset_shaping();
            true
        } else {
            false
        }
    }

    /// Get attributes list
    pub fn attrs_list(&self) -> &AttrsList {
        &self.attrs_list
    }

    /// Set attributes list
    ///
    /// Will reset shape and layout if it differs from current attributes list.
    /// Returns true if the line was reset
    pub fn set_attrs_list(&mut self, attrs_list: AttrsList) -> bool {
        if attrs_list != self.attrs_list {
            self.attrs_list = attrs_list;
            self.reset_shaping();
            true
        } else {
            false
        }
    }

    /// Get the Text alignment
    pub fn align(&self) -> Option<Align> {
        self.align
    }

    /// Set the text alignment
    ///
    /// Will reset layout if it differs from current alignment.
    /// Setting to None will use `Align::Right` for RTL lines, and `Align::Left` for LTR lines.
    /// Returns true if the line was reset
    pub fn set_align(&mut self, align: Option<Align>) -> bool {
        if align != self.align {
            self.align = align;
            self.reset_layout();
            true
        } else {
            false
        }
    }

    /// Append line at end of this line
    ///
    /// The wrap setting of the appended line will be lost
    pub fn append(&mut self, other: Self) {
        let len = self.text.len();
        self.text.push_str(other.text());

        if other.attrs_list.defaults() != self.attrs_list.defaults() {
            // If default formatting does not match, make a new span for it
            self.attrs_list
                .add_span(len..len + other.text().len(), &other.attrs_list.defaults());
        }

        for (other_range, attrs) in other.attrs_list.spans_iter() {
            // Add previous attrs spans
            let range = other_range.start + len..other_range.end + len;
            self.attrs_list.add_span(range, &attrs.as_attrs());
        }

        self.reset();
    }

    /// Split off new line at index
    pub fn split_off(&mut self, index: usize) -> Self {
        let text = self.text.split_off(index);
        let attrs_list = self.attrs_list.split_off(index);
        self.reset();

        let mut new = Self::new(text, self.ending, attrs_list, self.shaping);
        new.align = self.align;
        new
    }

    /// Reset shaping, layout, and metadata caches
    pub fn reset(&mut self) {
        self.metadata = None;
        self.reset_shaping();
    }

    /// Reset shaping and layout caches
    pub fn reset_shaping(&mut self) {
        self.shape_opt.set_unused();
        self.reset_layout();
    }

    /// Reset only layout cache
    pub fn reset_layout(&mut self) {
        self.layout_opt.set_unused();
    }

    /// Shape line, will cache results
    #[allow(clippy::missing_panics_doc)]
    pub fn shape(&mut self, font_system: &mut FontSystem, tab_width: u16) -> &ShapeLine {
        if self.shape_opt.is_unused() {
            #[cfg(feature = "std")]
            let shape_start = std::time::Instant::now();

            #[cfg(feature = "shape-run-cache")]
            {
                let key = crate::ShapeLineKey {
                    run: crate::ShapeRunKey::new(&self.text, &self.attrs_list, 0, self.text.len()),
                    tab_width,
                };
                if let Some(line) = font_system.shape_line_cache.get(&key) {
                    self.shape_opt.set_used(line);
                    self.layout_opt.set_unused();
                    return self.shape_opt.get().expect("shape not found");
                }
            }

            let mut line = self
                .shape_opt
                .take_unused()
                .unwrap_or_else(|| Rc::new(ShapeLine::empty()));
            match Rc::get_mut(&mut line) {
                Some(line) => line.build(
                    font_system,
                    &self.text,
                    &self.attrs_list,
                    self.shaping,
                    tab_width,
                ),
                None => {
                    let mut fresh = ShapeLine::empty();
                    fresh.build(
                        font_system,
                        &self.text,
                        &self.attrs_list,
                        self.shaping,
                        tab_width,
                    );
                    line = Rc::new(fresh);
                }
            }
            self.shape_opt.set_used(line);
            self.layout_opt.set_unused();

            #[cfg(feature = "shape-run-cache")]
            {
                let key = crate::ShapeLineKey {
                    run: crate::ShapeRunKey::new(&self.text, &self.attrs_list, 0, self.text.len()),
                    tab_width,
                };
                if let Some(built) = self.shape_opt.get() {
                    font_system
                        .shape_line_cache
                        .insert(key, Rc::clone(built));
                }
            }

            #[cfg(feature = "std")]
            crate::LINE_BUILD_NANOS.fetch_add(
                shape_start.elapsed().as_nanos() as u64,
                std::sync::atomic::Ordering::Relaxed,
            );
        }
        self.shape_opt.get().expect("shape not found")
    }

    /// Get line shaping cache
    pub fn shape_opt(&self) -> Option<&ShapeLine> {
        self.shape_opt.get().map(|line| &**line)
    }

    /// Layout line, will cache results
    #[allow(clippy::missing_panics_doc)]
    pub fn layout(
        &mut self,
        font_system: &mut FontSystem,
        font_size: f32,
        width_opt: Option<f32>,
        wrap: Wrap,
        match_mono_width: Option<f32>,
        tab_width: u16,
    ) -> &[LayoutLine] {
        if self.layout_opt.is_unused() {
            #[cfg(feature = "std")]
            let layout_start = std::time::Instant::now();

            #[cfg(feature = "shape-run-cache")]
            {
                let key = crate::LayoutRunKey {
                    line: crate::ShapeRunKey::new(
                        &self.text,
                        &self.attrs_list,
                        0,
                        self.text.len(),
                    ),
                    font_size_bits: font_size.to_bits(),
                    width_bits: width_opt.map(f32::to_bits),
                    wrap,
                    align: self.align,
                    match_mono_bits: match_mono_width.map(f32::to_bits),
                    tab_width,
                };
                if let Some(layout) = font_system.layout_run_cache.get(&key) {
                    // `LayoutRunIter` skips any line whose shape cache is
                    // empty, so a layout hit must still leave the line
                    // shaped (a cheap shape-line cache clone here).
                    let _ = self.shape(font_system, tab_width);
                    self.layout_opt.set_used(layout);
                    return self.layout_opt.get().expect("layout not found");
                }
            }

            let align = self.align;
            let mut layout = self
                .layout_opt
                .take_unused()
                .unwrap_or_else(|| Rc::new(Vec::with_capacity(1)));
            if Rc::get_mut(&mut layout).is_none() {
                layout = Rc::new(Vec::with_capacity(1));
            }
            let shape = self.shape(font_system, tab_width);
            let unique = Rc::get_mut(&mut layout).expect("layout Rc must be unique here");
            shape.layout_to_buffer(
                &mut font_system.shape_buffer,
                font_size,
                width_opt,
                wrap,
                align,
                unique,
                match_mono_width,
            );
            self.layout_opt.set_used(layout);

            #[cfg(feature = "shape-run-cache")]
            {
                let key = crate::LayoutRunKey {
                    line: crate::ShapeRunKey::new(
                        &self.text,
                        &self.attrs_list,
                        0,
                        self.text.len(),
                    ),
                    font_size_bits: font_size.to_bits(),
                    width_bits: width_opt.map(f32::to_bits),
                    wrap,
                    align: self.align,
                    match_mono_bits: match_mono_width.map(f32::to_bits),
                    tab_width,
                };
                if let Some(built) = self.layout_opt.get() {
                    font_system
                        .layout_run_cache
                        .insert(key, Rc::clone(built));
                }
            }

            #[cfg(feature = "std")]
            crate::LINE_LAYOUT_NANOS.fetch_add(
                layout_start.elapsed().as_nanos() as u64,
                std::sync::atomic::Ordering::Relaxed,
            );
        }
        self.layout_opt.get().expect("layout not found")
    }

    /// Get line layout cache
    pub fn layout_opt(&self) -> Option<&Vec<LayoutLine>> {
        self.layout_opt.get().map(|layout| &**layout)
    }

    /// Get line metadata. This will be None if [`BufferLine::set_metadata`] has not been called
    /// after the last reset of shaping and layout caches
    pub fn metadata(&self) -> Option<usize> {
        self.metadata
    }

    /// Set line metadata. This is stored until the next line reset
    pub fn set_metadata(&mut self, metadata: usize) {
        self.metadata = Some(metadata);
    }

    /// Makes an empty buffer line.
    ///
    /// The buffer line is in an invalid state after this is called. See [`Self::reset_new`].
    pub(crate) fn empty() -> Self {
        Self {
            text: String::default(),
            ending: LineEnding::default(),
            attrs_list: AttrsList::new(&Attrs::new()),
            align: None,
            shape_opt: Cached::Empty,
            layout_opt: Cached::Empty,
            shaping: Shaping::Advanced,
            metadata: None,
        }
    }

    /// Reclaim attributes list memory that isn't needed any longer.
    ///
    /// The buffer line is in an invalid state after this is called. See [`Self::reset_new`].
    pub(crate) fn reclaim_attrs(&mut self) -> AttrsList {
        mem::replace(&mut self.attrs_list, AttrsList::new(&Attrs::new()))
    }

    /// Reclaim text memory that isn't needed any longer.
    ///
    /// The buffer line is in an invalid state after this is called. See [`Self::reset_new`].
    pub(crate) fn reclaim_text(&mut self) -> String {
        let mut text = mem::take(&mut self.text);
        text.clear();
        text
    }
}
