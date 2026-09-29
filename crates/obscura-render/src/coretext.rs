//! CoreText/CoreGraphics glyph raster for canvas fillText (macOS): the
//! reference Chrome rasterizes canvas text through the system's CoreGraphics
//! pipeline, whose smoothing differs from any pure-software scanline
//! converter. Rendering the same glyphs through the same system pipeline is
//! the only byte-exact path. macOS-only; other hosts keep the software
//! rasterizer.

#![allow(non_snake_case, clippy::upper_case_acronyms)]

use std::ffi::c_void;
use std::sync::Arc;

// Force the framework-linking crates into the dependency graph: the raw
// extern declarations below reference symbols the system frameworks export,
// and without a reference the linker drops the crates that carry the
// #pragma-link directives.
use core_graphics as _core_graphics_link;
use core_text as _core_text_link;

type CFAllocatorRef = *const c_void;
type CGDataProviderRef = *const c_void;
type CGFontRef = *const c_void;
type CTFontRef = *const c_void;
type CGContextRef = *mut c_void;
type CGColorSpaceRef = *const c_void;
type CGGlyph = u16;
type UniChar = u16;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

/// CGAffineTransform by value (a null pointer here segfaults — the function
/// takes the struct by value).
#[repr(C)]
#[derive(Clone, Copy)]
struct CGAffineTransform {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    tx: f64,
    ty: f64,
}

impl CGAffineTransform {
    const IDENTITY: Self = Self { a: 1.0, b: 0.0, c: 0.0, d: 1.0, tx: 0.0, ty: 0.0 };
}

extern "C" {
    fn CGDataProviderCreateWithData(
        info: *const c_void,
        data: *const u8,
        size: usize,
        release: Option<unsafe extern "C" fn(*const c_void, *const c_void)>,
    ) -> CGDataProviderRef;
    fn CGFontCreateWithDataProvider(provider: CGDataProviderRef) -> CGFontRef;
    fn CTFontCreateWithGraphicsFont(
        graphicsFont: CGFontRef,
        size: f64,
        transform: *const c_void,
        attributes: *const c_void,
    ) -> CTFontRef;
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bitsPerComponent: usize,
        bytesPerRow: usize,
        space: CGColorSpaceRef,
        bitmapInfo: u32,
    ) -> CGContextRef;
    fn CGColorSpaceCreateDeviceRGB() -> CGColorSpaceRef;
    fn CGContextSetRGBFillColor(context: CGContextRef, r: f64, g: f64, b: f64, a: f64);
    fn CGContextSetGrayFillColor(context: CGContextRef, gray: f64, alpha: f64);
    fn CGContextSetTextPosition(context: CGContextRef, x: f64, y: f64);
    fn CGContextSetShouldAntialias(context: CGContextRef, flag: bool);
    fn CGContextSetAllowsFontSmoothing(context: CGContextRef, flag: bool);
    fn CGContextSetShouldSmoothFonts(context: CGContextRef, flag: bool);
    fn CGContextSetTextMatrix(context: CGContextRef, t: CGAffineTransform);
    fn CTFontGetGlyphsForCharacters(
        font: CTFontRef,
        characters: *const UniChar,
        glyphs: *mut CGGlyph,
        count: isize,
    ) -> bool;
    fn CTFontDrawGlyphs(
        font: CTFontRef,
        glyphs: *const CGGlyph,
        positions: *const CGPoint,
        count: usize,
        context: CGContextRef,
    );
}

unsafe extern "C" fn noop_release(_info: *const c_void, _data: *const c_void) {}

/// One font file registered with CoreGraphics, held for the process: the
/// provider references the bytes without copying them, so the Arc must outlive
/// every CTFont minted from it.
pub struct CoreTextFace {
    font: CTFontRef,
    _data: Arc<Vec<u8>>,
}

impl CoreTextFace {
    /// Register `data` (a font file's bytes) with CoreGraphics and mint a
    /// CTFont of `size` px from the first face in the collection.
    pub fn from_bytes(data: Arc<Vec<u8>>, size: f64) -> Option<Self> {
        unsafe {
            let provider = CGDataProviderCreateWithData(
                std::ptr::null(),
                data.as_ptr(),
                data.len(),
                Some(noop_release),
            );
            if provider.is_null() {
                return None;
            }
            let cgfont = CGFontCreateWithDataProvider(provider);
            if cgfont.is_null() {
                return None;
            }
            let font = CTFontCreateWithGraphicsFont(cgfont, size, std::ptr::null(), std::ptr::null());
            if font.is_null() {
                return None;
            }
            Some(Self { font, _data: data })
        }
    }

    /// A character's glyph in this face (the same cmap the shaper's face
    /// resolves through).
    pub fn glyph_for_char(&self, ch: char) -> Option<CGGlyph> {
        let c = ch as UniChar;
        let mut glyph: CGGlyph = 0;
        unsafe {
            if CTFontGetGlyphsForCharacters(self.font, &c, &mut glyph, 1) && glyph != 0 {
                Some(glyph)
            } else {
                None
            }
        }
    }

    /// Render one glyph with its origin at (pen_x, baseline_y) on a grayscale
    /// `width`x`height` surface whose origin is top-left, and return the
    /// coverage bytes row-major. CoreGraphics' own smoothing produces the
    /// mask -- the same pipeline the reference browser's canvas text runs.
    pub fn draw_glyph_gray(
        &self,
        glyph: CGGlyph,
        pen_x: f64,
        baseline_y: f64,
        width: usize,
        height: usize,
    ) -> Option<Vec<u8>> {
        unsafe {
            // RGBA premultiplied-last: the format a real canvas backing
            // store uses (the gray path rasterizes through a different CG
            // code path with different edge behavior).
            let space = CGColorSpaceCreateDeviceRGB();
            let mut buf = vec![0u8; width * height * 4];
            let ctx = CGBitmapContextCreate(
                buf.as_mut_ptr() as *mut c_void,
                width,
                height,
                8,
                width * 4,
                space,
                1, // kCGImageAlphaPremultipliedLast
            );
            if ctx.is_null() {
                return None;
            }
            CGContextSetShouldAntialias(ctx, true);
            CGContextSetShouldSmoothFonts(ctx, true);
            CGContextSetAllowsFontSmoothing(ctx, true);
            CGContextSetRGBFillColor(ctx, 0.0, 0.0, 0.0, 1.0);
            CGContextSetTextMatrix(ctx, CGAffineTransform::IDENTITY);
            // Bitmap contexts are y-down at the top-left; flip so the pen's
            // baseline lands at `baseline_y` from the top.
            // The buffer is stored bottom-up relative to CG's own y-up user
            // space (measured: pen y = height - baseline_y puts the glyph's
            // ink on the canvas rows the reference puts it on).
            let pos = CGPoint {
                x: pen_x,
                y: height as f64 - baseline_y,
            };
            CGContextSetTextPosition(ctx, pos.x, pos.y);
            CTFontDrawGlyphs(self.font, &glyph, &pos, 1, ctx);
            // Extract the alpha channel row-major (the canvas coverage).
            let mut out = Vec::with_capacity(width * height);
            for px in buf.chunks_exact(4) {
                out.push(px[3]);
            }
            Some(out)
        }
    }
}

#[cfg(test)]
mod spike_tests {
    use super::*;

    #[test]
    fn spike_liberation_a16() {
        if std::env::var("OBSCURA_DUMP_CT").is_err() {
            return;
        }
        let data: Arc<Vec<u8>> = Arc::new(std::fs::read(
            concat!(env!("CARGO_MANIFEST_DIR"), "/assets/liberation-sans.ttf"),
        )
        .expect("liberation bytes"));
        let face = CoreTextFace::from_bytes(data, 16.0).expect("face");
        let glyph = face.glyph_for_char('F').expect("glyph F");
        let mask = face.draw_glyph_gray(glyph, 4.0, 20.0, 24, 24).expect("mask");
        for (yy, row) in mask.chunks_exact(24).enumerate() {
            let line: String = row.iter().map(|v| format!("{:02x}", v)).collect();
            println!("{:02} {}", yy, line);
        }
    }
}
