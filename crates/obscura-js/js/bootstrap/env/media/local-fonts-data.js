// Local Font Access: queryLocalFonts() enumeration data. Captured from the
// pinned reference (Chrome 149, 631 FontData rows: postscriptName|fullName|
// family, pipe-separated) -- the reference profile has Local Font Access
// allowed, so queryLocalFonts resolves this full system enumeration, where
// this engine used to reject with NotAllowedError (breaking the challenge's
// font probe at its first step -- the tUxL6/OyfhW8 fallback).
var _localFontRows = null;
function _localFontData() {
  if (_localFontRows) return _localFontRows;
  _localFontRows = [];
  const rows = `Academy Engraved LET Plain:1.0|Academy Engraved LET|AcademyEngravedLetPlain
Al Bayan Plain|Al Bayan|AlBayan
Al Bayan Bold|Al Bayan|AlBayan-Bold
Al Nile|Al Nile|AlNile
Al Nile Bold|Al Nile|AlNile-Bold
Al Tarikh Regular|Al Tarikh|AlTarikh
American Typewriter|American Typewriter|AmericanTypewriter
American Typewriter Bold|American Typewriter|AmericanTypewriter-Bold
American Typewriter Condensed|American Typewriter|AmericanTypewriter-Condensed
American Typewriter Condensed Bold|American Typewriter|AmericanTypewriter-CondensedBold
American Typewriter Condensed Light|American Typewriter|AmericanTypewriter-CondensedLight
American Typewriter Light|American Typewriter|AmericanTypewriter-Light
American Typewriter Semibold|American Typewriter|AmericanTypewriter-Semibold
Andale Mono|Andale Mono|AndaleMono
Apple Chancery|Apple Chancery|Apple-Chancery
Apple Braille|Apple Braille|AppleBraille
Apple Braille Outline 6 Dot|Apple Braille|AppleBraille-Outline6Dot
Apple Braille Outline 8 Dot|Apple Braille|AppleBraille-Outline8Dot
Apple Braille Pinpoint 6 Dot|Apple Braille|AppleBraille-Pinpoint6Dot
Apple Braille Pinpoint 8 Dot|Apple Braille|AppleBraille-Pinpoint8Dot
Apple Color Emoji|Apple Color Emoji|AppleColorEmoji
AppleGothic Regular|AppleGothic|AppleGothic
AppleMyungjo Regular|AppleMyungjo|AppleMyungjo
Apple SD Gothic Neo Bold|Apple SD Gothic Neo|AppleSDGothicNeo-Bold
Apple SD Gothic Neo ExtraBold|Apple SD Gothic Neo|AppleSDGothicNeo-ExtraBold
Apple SD Gothic Neo Heavy|Apple SD Gothic Neo|AppleSDGothicNeo-Heavy
Apple SD Gothic Neo Light|Apple SD Gothic Neo|AppleSDGothicNeo-Light
Apple SD Gothic Neo Medium|Apple SD Gothic Neo|AppleSDGothicNeo-Medium
Apple SD Gothic Neo Regular|Apple SD Gothic Neo|AppleSDGothicNeo-Regular
Apple SD Gothic Neo SemiBold|Apple SD Gothic Neo|AppleSDGothicNeo-SemiBold
Apple SD Gothic Neo Thin|Apple SD Gothic Neo|AppleSDGothicNeo-Thin
Apple SD Gothic Neo UltraLight|Apple SD Gothic Neo|AppleSDGothicNeo-UltraLight
Apple Symbols|Apple Symbols|AppleSymbols
Arial Black|Arial Black|Arial-Black
Arial Bold Italic|Arial|Arial-BoldItalicMT
Arial Bold|Arial|Arial-BoldMT
Arial Italic|Arial|Arial-ItalicMT
Arial Hebrew|Arial Hebrew|ArialHebrew
Arial Hebrew Bold|Arial Hebrew|ArialHebrew-Bold
Arial Hebrew Light|Arial Hebrew|ArialHebrew-Light
Arial Hebrew Scholar|Arial Hebrew Scholar|ArialHebrewScholar
Arial Hebrew Scholar Bold|Arial Hebrew Scholar|ArialHebrewScholar-Bold
Arial Hebrew Scholar Light|Arial Hebrew Scholar|ArialHebrewScholar-Light
Arial|Arial|ArialMT
Arial Narrow|Arial Narrow|ArialNarrow
Arial Narrow Bold|Arial Narrow|ArialNarrow-Bold
Arial Narrow Bold Italic|Arial Narrow|ArialNarrow-BoldItalic
Arial Narrow Italic|Arial Narrow|ArialNarrow-Italic
Arial Rounded MT Bold|Arial Rounded MT Bold|ArialRoundedMTBold
Arial Unicode MS|Arial Unicode MS|ArialUnicodeMS
Avenir Black|Avenir|Avenir-Black
Avenir Black Oblique|Avenir|Avenir-BlackOblique
Avenir Book|Avenir|Avenir-Book
Avenir Book Oblique|Avenir|Avenir-BookOblique
Avenir Heavy|Avenir|Avenir-Heavy
Avenir Heavy Oblique|Avenir|Avenir-HeavyOblique
Avenir Light|Avenir|Avenir-Light
Avenir Light Oblique|Avenir|Avenir-LightOblique
Avenir Medium|Avenir|Avenir-Medium
Avenir Medium Oblique|Avenir|Avenir-MediumOblique
Avenir Oblique|Avenir|Avenir-Oblique
Avenir Roman|Avenir|Avenir-Roman
Avenir Next Bold|Avenir Next|AvenirNext-Bold
Avenir Next Bold Italic|Avenir Next|AvenirNext-BoldItalic
Avenir Next Demi Bold|Avenir Next|AvenirNext-DemiBold
Avenir Next Demi Bold Italic|Avenir Next|AvenirNext-DemiBoldItalic
Avenir Next Heavy|Avenir Next|AvenirNext-Heavy
Avenir Next Heavy Italic|Avenir Next|AvenirNext-HeavyItalic
Avenir Next Italic|Avenir Next|AvenirNext-Italic
Avenir Next Medium|Avenir Next|AvenirNext-Medium
Avenir Next Medium Italic|Avenir Next|AvenirNext-MediumItalic
Avenir Next Regular|Avenir Next|AvenirNext-Regular
Avenir Next Ultra Light|Avenir Next|AvenirNext-UltraLight
Avenir Next Ultra Light Italic|Avenir Next|AvenirNext-UltraLightItalic
Avenir Next Condensed Bold|Avenir Next Condensed|AvenirNextCondensed-Bold
Avenir Next Condensed Bold Italic|Avenir Next Condensed|AvenirNextCondensed-BoldItalic
Avenir Next Condensed Demi Bold|Avenir Next Condensed|AvenirNextCondensed-DemiBold
Avenir Next Condensed Demi Bold Italic|Avenir Next Condensed|AvenirNextCondensed-DemiBoldItalic
Avenir Next Condensed Heavy|Avenir Next Condensed|AvenirNextCondensed-Heavy
Avenir Next Condensed Heavy Italic|Avenir Next Condensed|AvenirNextCondensed-HeavyItalic
Avenir Next Condensed Italic|Avenir Next Condensed|AvenirNextCondensed-Italic
Avenir Next Condensed Medium|Avenir Next Condensed|AvenirNextCondensed-Medium
Avenir Next Condensed Medium Italic|Avenir Next Condensed|AvenirNextCondensed-MediumItalic
Avenir Next Condensed Regular|Avenir Next Condensed|AvenirNextCondensed-Regular
Avenir Next Condensed Ultra Light|Avenir Next Condensed|AvenirNextCondensed-UltraLight
Avenir Next Condensed Ultra Light Italic|Avenir Next Condensed|AvenirNextCondensed-UltraLightItalic
Ayuthaya|Ayuthaya|Ayuthaya
BIZ UDGothic Bold|BIZ UDGothic|BIZUDGothic-Bold
BIZ UDGothic|BIZ UDGothic|BIZUDGothic-Regular
BIZ UDMincho|BIZ UDMincho|BIZUDMincho-Regular
BM DoHyeon OTF|BM Dohyeon|BMDoHyeon-OTF
BM HANNA 11yrs old OTF|BM Hanna 11yrs Old|BMHANNA11yrsoldOTF
BM HANNA Air OTF|BM Hanna Air|BMHANNAAirOTF
BM HANNA Pro OTF|BM Hanna Pro|BMHANNAProOTF
BM JUA OTF|BM Jua|BMJUAOTF
BM KIRANGHAERANG OTF|BM Kirang Haerang|BMKIRANGHAERANG-OTF
BM YEONSUNG OTF|BM Yeonsung|BMYEONSUNG-OTF
Baghdad Regular|Baghdad|Baghdad
Bangla MN|Bangla MN|BanglaMN
Bangla MN Bold|Bangla MN|BanglaMN-Bold
Bangla Sangam MN|Bangla Sangam MN|BanglaSangamMN
Bangla Sangam MN Bold|Bangla Sangam MN|BanglaSangamMN-Bold
Baskerville|Baskerville|Baskerville
Baskerville Bold|Baskerville|Baskerville-Bold
Baskerville Bold Italic|Baskerville|Baskerville-BoldItalic
Baskerville Italic|Baskerville|Baskerville-Italic
Baskerville SemiBold|Baskerville|Baskerville-SemiBold
Baskerville SemiBold Italic|Baskerville|Baskerville-SemiBoldItalic
Beirut Regular|Beirut|Beirut
標楷體-港澳|BiauKaiHK|BiauKaiHK-Regular
標楷體-繁|BiauKaiTC|BiauKaiTC-Regular
Big Caslon Medium|Big Caslon|BigCaslon-Medium
Bodoni Ornaments|Bodoni Ornaments|BodoniOrnamentsITCTT
Bodoni 72 Bold|Bodoni 72|BodoniSvtyTwoITCTT-Bold
Bodoni 72 Book|Bodoni 72|BodoniSvtyTwoITCTT-Book
Bodoni 72 Book Italic|Bodoni 72|BodoniSvtyTwoITCTT-BookIta
Bodoni 72 Oldstyle Bold|Bodoni 72 Oldstyle|BodoniSvtyTwoOSITCTT-Bold
Bodoni 72 Oldstyle Book|Bodoni 72 Oldstyle|BodoniSvtyTwoOSITCTT-Book
Bodoni 72 Oldstyle Book Italic|Bodoni 72 Oldstyle|BodoniSvtyTwoOSITCTT-BookIt
Bodoni 72 Smallcaps Book|Bodoni 72 Smallcaps|BodoniSvtyTwoSCITCTT-Book
Bradley Hand Bold|Bradley Hand|BradleyHandITCTT-Bold
Brush Script MT Italic|Brush Script MT|BrushScriptMT
Chalkboard|Chalkboard|Chalkboard
Chalkboard Bold|Chalkboard|Chalkboard-Bold
Chalkboard SE Bold|Chalkboard SE|ChalkboardSE-Bold
Chalkboard SE Light|Chalkboard SE|ChalkboardSE-Light
Chalkboard SE Regular|Chalkboard SE|ChalkboardSE-Regular
Chalkduster|Chalkduster|Chalkduster
Charter Black|Charter|Charter-Black
Charter Black Italic|Charter|Charter-BlackItalic
Charter Bold|Charter|Charter-Bold
Charter Bold Italic|Charter|Charter-BoldItalic
Charter Italic|Charter|Charter-Italic
Charter Roman|Charter|Charter-Roman
Cochin|Cochin|Cochin
Cochin Bold|Cochin|Cochin-Bold
Cochin Bold Italic|Cochin|Cochin-BoldItalic
Cochin Italic|Cochin|Cochin-Italic
Comic Sans MS|Comic Sans MS|ComicSansMS
Comic Sans MS Bold|Comic Sans MS|ComicSansMS-Bold
Copperplate|Copperplate|Copperplate
Copperplate Bold|Copperplate|Copperplate-Bold
Copperplate Light|Copperplate|Copperplate-Light
Corsiva Hebrew|Corsiva Hebrew|CorsivaHebrew
Corsiva Hebrew Bold|Corsiva Hebrew|CorsivaHebrew-Bold
Courier New Bold Italic|Courier New|CourierNewPS-BoldItalicMT
Courier New Bold|Courier New|CourierNewPS-BoldMT
Courier New Italic|Courier New|CourierNewPS-ItalicMT
Courier New|Courier New|CourierNewPSMT
娃娃体-简 常规体|Wawati SC|DFWaWaSC-W5
娃娃体-繁 常规体|Wawati TC|DFWaWaTC-W5
DIN Alternate Bold|DIN Alternate|DINAlternate-Bold
DIN Condensed Bold|DIN Condensed|DINCondensed-Bold
Damascus Regular|Damascus|Damascus
Damascus Bold|Damascus|DamascusBold
Damascus Light|Damascus|DamascusLight
Damascus Medium|Damascus|DamascusMedium
Damascus Semi Bold|Damascus|DamascusSemiBold
DecoType Naskh Regular|DecoType Naskh|DecoTypeNaskh
Devanagari MT|Devanagari MT|DevanagariMT
Devanagari MT Bold|Devanagari MT|DevanagariMT-Bold
Devanagari Sangam MN|Devanagari Sangam MN|DevanagariSangamMN
Devanagari Sangam MN Bold|Devanagari Sangam MN|DevanagariSangamMN-Bold
Didot|Didot|Didot
Didot Bold|Didot|Didot-Bold
Didot Italic|Didot|Didot-Italic
Diwan Kufi Regular|Diwan Kufi|DiwanKufi
Mishafi Regular|Mishafi|DiwanMishafi
Mishafi Gold Regular|Mishafi Gold|DiwanMishafiGold
Diwan Thuluth Regular|Diwan Thuluth|DiwanThuluth
Euphemia UCAS|Euphemia UCAS|EuphemiaUCAS
Euphemia UCAS Bold|Euphemia UCAS|EuphemiaUCAS-Bold
Euphemia UCAS Italic|Euphemia UCAS|EuphemiaUCAS-Italic
兰亭黑-繁 特黑|Lantinghei TC|FZLTTHB--B51-0
兰亭黑-简 特黑|Lantinghei SC|FZLTTHK--GBK1-0
兰亭黑-繁 纤黑|Lantinghei TC|FZLTXHB--B51-0
兰亭黑-简 纤黑|Lantinghei SC|FZLTXHK--GBK1-0
兰亭黑-繁 中黑|Lantinghei TC|FZLTZHB--B51-0
兰亭黑-简 中黑|Lantinghei SC|FZLTZHK--GBK1-0
Farah Regular|Farah|Farah
Farisi Regular|Farisi|Farisi
Futura Bold|Futura|Futura-Bold
Futura Condensed ExtraBold|Futura|Futura-CondensedExtraBold
Futura Condensed Medium|Futura|Futura-CondensedMedium
Futura Medium|Futura|Futura-Medium
Futura Medium Italic|Futura|Futura-MediumItalic
GB18030 Bitmap|GB18030 Bitmap|GB18030Bitmap
Galvji|Galvji|Galvji
Galvji Bold|Galvji|Galvji-Bold
Galvji Bold Oblique|Galvji|Galvji-BoldOblique
Galvji Oblique|Galvji|Galvji-Oblique
Geeza Pro Regular|Geeza Pro|GeezaPro
Geeza Pro Bold|Geeza Pro|GeezaPro-Bold
Geneva|Geneva|Geneva
Georgia|Georgia|Georgia
Georgia Bold|Georgia|Georgia-Bold
Georgia Bold Italic|Georgia|Georgia-BoldItalic
Georgia Italic|Georgia|Georgia-Italic
Gill Sans|Gill Sans|GillSans
Gill Sans Bold|Gill Sans|GillSans-Bold
Gill Sans Bold Italic|Gill Sans|GillSans-BoldItalic
Gill Sans Italic|Gill Sans|GillSans-Italic
Gill Sans Light|Gill Sans|GillSans-Light
Gill Sans Light Italic|Gill Sans|GillSans-LightItalic
Gill Sans SemiBold|Gill Sans|GillSans-SemiBold
Gill Sans SemiBold Italic|Gill Sans|GillSans-SemiBoldItalic
Gill Sans UltraBold|Gill Sans|GillSans-UltraBold
Grantha Sangam MN Bold|Grantha Sangam MN|GranthaSangamMN-Bold
Grantha Sangam MN Regular|Grantha Sangam MN|GranthaSangamMN-Regular
Gujarati MT|Gujarati MT|GujaratiMT
Gujarati MT Bold|Gujarati MT|GujaratiMT-Bold
Gujarati Sangam MN|Gujarati Sangam MN|GujaratiSangamMN
Gujarati Sangam MN Bold|Gujarati Sangam MN|GujaratiSangamMN-Bold
Gurmukhi MN|Gurmukhi MN|GurmukhiMN
Gurmukhi MN Bold|Gurmukhi MN|GurmukhiMN-Bold
Gurmukhi Sangam MN|Gurmukhi Sangam MN|GurmukhiSangamMN
Gurmukhi Sangam MN Bold|Gurmukhi Sangam MN|GurmukhiSangamMN-Bold
手札体-简 常规体|Hannotate SC|HannotateSC-W5
手札体-简 粗体|Hannotate SC|HannotateSC-W7
手札体-繁 常规体|Hannotate TC|HannotateTC-W5
手札体-繁 粗体|Hannotate TC|HannotateTC-W7
翩翩体-简 常规体|HanziPen SC|HanziPenSC-W3
翩翩体-简 粗体|HanziPen SC|HanziPenSC-W5
翩翩体-繁 常规体|HanziPen TC|HanziPenTC-W3
翩翩体-繁 粗体|HanziPen TC|HanziPenTC-W5
Helvetica|Helvetica|Helvetica
Helvetica Bold|Helvetica|Helvetica-Bold
Helvetica Bold Oblique|Helvetica|Helvetica-BoldOblique
Helvetica Light|Helvetica|Helvetica-Light
Helvetica Light Oblique|Helvetica|Helvetica-LightOblique
Helvetica Oblique|Helvetica|Helvetica-Oblique
Helvetica Neue|Helvetica Neue|HelveticaNeue
Helvetica Neue Bold|Helvetica Neue|HelveticaNeue-Bold
Helvetica Neue Bold Italic|Helvetica Neue|HelveticaNeue-BoldItalic
Helvetica Neue Condensed Black|Helvetica Neue|HelveticaNeue-CondensedBlack
Helvetica Neue Condensed Bold|Helvetica Neue|HelveticaNeue-CondensedBold
Helvetica Neue Italic|Helvetica Neue|HelveticaNeue-Italic
Helvetica Neue Light|Helvetica Neue|HelveticaNeue-Light
Helvetica Neue Light Italic|Helvetica Neue|HelveticaNeue-LightItalic
Helvetica Neue Medium|Helvetica Neue|HelveticaNeue-Medium
Helvetica Neue Medium Italic|Helvetica Neue|HelveticaNeue-MediumItalic
Helvetica Neue Thin|Helvetica Neue|HelveticaNeue-Thin
Helvetica Neue Thin Italic|Helvetica Neue|HelveticaNeue-ThinItalic
Helvetica Neue UltraLight|Helvetica Neue|HelveticaNeue-UltraLight
Helvetica Neue UltraLight Italic|Helvetica Neue|HelveticaNeue-UltraLightItalic
Herculanum|Herculanum|Herculanum
Hiragino Maru Gothic ProN W4|Hiragino Maru Gothic ProN|HiraMaruProN-W4
Hiragino Mincho ProN W3|Hiragino Mincho ProN|HiraMinProN-W3
Hiragino Mincho ProN W6|Hiragino Mincho ProN|HiraMinProN-W6
Hiragino Sans W0|Hiragino Sans|HiraginoSans-W0
Hiragino Sans W1|Hiragino Sans|HiraginoSans-W1
Hiragino Sans W2|Hiragino Sans|HiraginoSans-W2
Hiragino Sans W3|Hiragino Sans|HiraginoSans-W3
Hiragino Sans W4|Hiragino Sans|HiraginoSans-W4
Hiragino Sans W5|Hiragino Sans|HiraginoSans-W5
Hiragino Sans W6|Hiragino Sans|HiraginoSans-W6
Hiragino Sans W7|Hiragino Sans|HiraginoSans-W7
Hiragino Sans W8|Hiragino Sans|HiraginoSans-W8
Hiragino Sans W9|Hiragino Sans|HiraginoSans-W9
冬青黑体简体中文 W3|Hiragino Sans GB|HiraginoSansGB-W3
冬青黑体简体中文 W6|Hiragino Sans GB|HiraginoSansGB-W6
Hoefler Text Black|Hoefler Text|HoeflerText-Black
Hoefler Text Black Italic|Hoefler Text|HoeflerText-BlackItalic
Hoefler Text Italic|Hoefler Text|HoeflerText-Italic
Hoefler Text Ornaments|Hoefler Text|HoeflerText-Ornaments
Hoefler Text|Hoefler Text|HoeflerText-Regular
ITF Devanagari Bold|ITF Devanagari|ITFDevanagari-Bold
ITF Devanagari Book|ITF Devanagari|ITFDevanagari-Book
ITF Devanagari Demi|ITF Devanagari|ITFDevanagari-Demi
ITF Devanagari Light|ITF Devanagari|ITFDevanagari-Light
ITF Devanagari Medium|ITF Devanagari|ITFDevanagari-Medium
ITF Devanagari Marathi Bold|ITF Devanagari Marathi|ITFDevanagariMarathi-Bold
ITF Devanagari Marathi Book|ITF Devanagari Marathi|ITFDevanagariMarathi-Book
ITF Devanagari Marathi Demi|ITF Devanagari Marathi|ITFDevanagariMarathi-Demi
ITF Devanagari Marathi Light|ITF Devanagari Marathi|ITFDevanagariMarathi-Light
ITF Devanagari Marathi Medium|ITF Devanagari Marathi|ITFDevanagariMarathi-Medium
Impact|Impact|Impact
InaiMathi|InaiMathi|InaiMathi
InaiMathi Bold|InaiMathi|InaiMathi-Bold
HeadLineA Regular|HeadLineA|JCHEadA
PilGi Regular|PilGi|JCfg
GungSeo Regular|GungSeo|JCkg
PCMyungjo Regular|PCMyungjo|JCsmPC
Kailasa Regular|Kailasa|Kailasa
Kailasa Bold|Kailasa|Kailasa-Bold
Kannada MN|Kannada MN|KannadaMN
Kannada MN Bold|Kannada MN|KannadaMN-Bold
Kannada Sangam MN|Kannada Sangam MN|KannadaSangamMN
Kannada Sangam MN Bold|Kannada Sangam MN|KannadaSangamMN-Bold
Kefa III Regular Bold|Kefa III|KefaIII-Bold
Kefa III Regular ExtraBold|Kefa III|KefaIII-ExtraBold
Kefa III Regular Light|Kefa III|KefaIII-Light
Kefa III Regular Regular|Kefa III|KefaIII-Regular
Khmer MN|Khmer MN|KhmerMN
Khmer MN Bold|Khmer MN|KhmerMN-Bold
Khmer Sangam MN|Khmer Sangam MN|KhmerSangamMN
Klee Demibold|Klee|Klee-Demibold
Klee Medium|Klee|Klee-Medium
Kohinoor Bangla Bold|Kohinoor Bangla|KohinoorBangla-Bold
Kohinoor Bangla Light|Kohinoor Bangla|KohinoorBangla-Light
Kohinoor Bangla Medium|Kohinoor Bangla|KohinoorBangla-Medium
Kohinoor Bangla|Kohinoor Bangla|KohinoorBangla-Regular
Kohinoor Bangla Semibold|Kohinoor Bangla|KohinoorBangla-Semibold
Kohinoor Devanagari Bold|Kohinoor Devanagari|KohinoorDevanagari-Bold
Kohinoor Devanagari Light|Kohinoor Devanagari|KohinoorDevanagari-Light
Kohinoor Devanagari Medium|Kohinoor Devanagari|KohinoorDevanagari-Medium
Kohinoor Devanagari Regular|Kohinoor Devanagari|KohinoorDevanagari-Regular
Kohinoor Devanagari Semibold|Kohinoor Devanagari|KohinoorDevanagari-Semibold
Kohinoor Gujarati Bold|Kohinoor Gujarati|KohinoorGujarati-Bold
Kohinoor Gujarati Light|Kohinoor Gujarati|KohinoorGujarati-Light
Kohinoor Gujarati Medium|Kohinoor Gujarati|KohinoorGujarati-Medium
Kohinoor Gujarati Regular|Kohinoor Gujarati|KohinoorGujarati-Regular
Kohinoor Gujarati Semibold|Kohinoor Gujarati|KohinoorGujarati-Semibold
Kohinoor Telugu Bold|Kohinoor Telugu|KohinoorTelugu-Bold
Kohinoor Telugu Light|Kohinoor Telugu|KohinoorTelugu-Light
Kohinoor Telugu Medium|Kohinoor Telugu|KohinoorTelugu-Medium
Kohinoor Telugu|Kohinoor Telugu|KohinoorTelugu-Regular
Kohinoor Telugu Semibold|Kohinoor Telugu|KohinoorTelugu-Semibold
Kokonor Regular|Kokonor|Kokonor
Krungthep|Krungthep|Krungthep
KufiStandardGK Regular|KufiStandardGK|KufiStandardGK
Lao MN|Lao MN|LaoMN
Lao MN Bold|Lao MN|LaoMN-Bold
Lao Sangam MN|Lao Sangam MN|LaoSangamMN
蘋果儷中黑|Apple LiGothic|LiGothicMed
儷黑 Pro|LiHei Pro|LiHeiPro
儷宋 Pro|LiSong Pro|LiSongPro
蘋果儷細宋|Apple LiSung|LiSungLight
Lucida Grande|Lucida Grande|LucidaGrande
Lucida Grande Bold|Lucida Grande|LucidaGrande-Bold
Luminari|Luminari|Luminari-Regular
凌慧体-简 中黑体|LingWai SC|MLingWaiMedium-SC
凌慧体-繁 中黑体|LingWai TC|MLingWaiMedium-TC
Malayalam MN|Malayalam MN|MalayalamMN
Malayalam MN Bold|Malayalam MN|MalayalamMN-Bold
Malayalam Sangam MN|Malayalam Sangam MN|MalayalamSangamMN
Malayalam Sangam MN Bold|Malayalam Sangam MN|MalayalamSangamMN-Bold
Marker Felt Thin|Marker Felt|MarkerFelt-Thin
Marker Felt Wide|Marker Felt|MarkerFelt-Wide
Menlo Bold|Menlo|Menlo-Bold
Menlo Bold Italic|Menlo|Menlo-BoldItalic
Menlo Italic|Menlo|Menlo-Italic
Menlo Regular|Menlo|Menlo-Regular
Microsoft Sans Serif|Microsoft Sans Serif|MicrosoftSansSerif
Monaco|Monaco|Monaco
Gurmukhi MT|Gurmukhi MT|MonotypeGurmukhi
Mshtakan|Mshtakan|Mshtakan
Mshtakan Bold|Mshtakan|MshtakanBold
Mshtakan BoldOblique|Mshtakan|MshtakanBoldOblique
Mshtakan Oblique|Mshtakan|MshtakanOblique
MuktaMahee Bold|Mukta Mahee|MuktaMahee-Bold
MuktaMahee ExtraBold|Mukta Mahee|MuktaMahee-ExtraBold
MuktaMahee ExtraLight|Mukta Mahee|MuktaMahee-ExtraLight
MuktaMahee Light|Mukta Mahee|MuktaMahee-Light
MuktaMahee Medium|Mukta Mahee|MuktaMahee-Medium
MuktaMahee Regular|Mukta Mahee|MuktaMahee-Regular
MuktaMahee SemiBold|Mukta Mahee|MuktaMahee-SemiBold
Muna Regular|Muna|Muna
Muna Black|Muna|MunaBlack
Muna Bold|Muna|MunaBold
Myanmar MN|Myanmar MN|MyanmarMN
Myanmar MN Bold|Myanmar MN|MyanmarMN-Bold
Myanmar Sangam MN|Myanmar Sangam MN|MyanmarSangamMN
Myanmar Sangam MN Bold|Myanmar Sangam MN|MyanmarSangamMN-Bold
Nadeem Regular|Nadeem|Nadeem
Nanum Brush Script|Nanum Brush Script|NanumBrush
NanumGothic|Nanum Gothic|NanumGothic
NanumGothic Bold|Nanum Gothic|NanumGothicBold
NanumGothic ExtraBold|Nanum Gothic|NanumGothicExtraBold
NanumMyeongjo|Nanum Myeongjo|NanumMyeongjo
NanumMyeongjo Bold|Nanum Myeongjo|NanumMyeongjoBold
NanumMyeongjo ExtraBold|Nanum Myeongjo|NanumMyeongjoExtraBold
Nanum Pen Script|Nanum Pen Script|NanumPen
New Peninim MT|New Peninim MT|NewPeninimMT
New Peninim MT Bold|New Peninim MT|NewPeninimMT-Bold
New Peninim MT Bold Inclined|New Peninim MT|NewPeninimMT-BoldInclined
New Peninim MT Inclined|New Peninim MT|NewPeninimMT-Inclined
Noteworthy Bold|Noteworthy|Noteworthy-Bold
Noteworthy Light|Noteworthy|Noteworthy-Light
Noto Nastaliq Urdu|Noto Nastaliq Urdu|NotoNastaliqUrdu
Noto Nastaliq Urdu Bold|Noto Nastaliq Urdu|NotoNastaliqUrdu-Bold
Noto Sans Batak Regular|Noto Sans Batak|NotoSansBatak-Regular
Noto Sans Kannada Black|Noto Sans Kannada|NotoSansKannada-Black
Noto Sans Kannada Bold|Noto Sans Kannada|NotoSansKannada-Bold
Noto Sans Kannada ExtraBold|Noto Sans Kannada|NotoSansKannada-ExtraBold
Noto Sans Kannada ExtraLight|Noto Sans Kannada|NotoSansKannada-ExtraLight
Noto Sans Kannada Light|Noto Sans Kannada|NotoSansKannada-Light
Noto Sans Kannada Medium|Noto Sans Kannada|NotoSansKannada-Medium
Noto Sans Kannada Regular|Noto Sans Kannada|NotoSansKannada-Regular
Noto Sans Kannada SemiBold|Noto Sans Kannada|NotoSansKannada-SemiBold
Noto Sans Kannada Thin|Noto Sans Kannada|NotoSansKannada-Thin
Noto Sans Myanmar Black|Noto Sans Myanmar|NotoSansMyanmar-Black
Noto Sans Myanmar Bold|Noto Sans Myanmar|NotoSansMyanmar-Bold
Noto Sans Myanmar ExtraBold|Noto Sans Myanmar|NotoSansMyanmar-ExtraBold
Noto Sans Myanmar ExtraLight|Noto Sans Myanmar|NotoSansMyanmar-ExtraLight
Noto Sans Myanmar Light|Noto Sans Myanmar|NotoSansMyanmar-Light
Noto Sans Myanmar Medium|Noto Sans Myanmar|NotoSansMyanmar-Medium
Noto Sans Myanmar Regular|Noto Sans Myanmar|NotoSansMyanmar-Regular
Noto Sans Myanmar SemiBold|Noto Sans Myanmar|NotoSansMyanmar-SemiBold
Noto Sans Myanmar Thin|Noto Sans Myanmar|NotoSansMyanmar-Thin
Noto Sans NKo Regular|Noto Sans NKo|NotoSansNKo-Regular
Noto Sans Oriya|Noto Sans Oriya|NotoSansOriya
Noto Sans Oriya Bold|Noto Sans Oriya|NotoSansOriya-Bold
Noto Sans Syriac Regular Regular|Noto Sans Syriac|NotoSansSyriac-Regular
Noto Sans Syriac Regular Black|Noto Sans Syriac|NotoSansSyriac-Regular_Black
Noto Sans Syriac Regular Bold|Noto Sans Syriac|NotoSansSyriac-Regular_Bold
Noto Sans Syriac Regular ExtraBold|Noto Sans Syriac|NotoSansSyriac-Regular_ExtraBold
Noto Sans Syriac Regular ExtraLight|Noto Sans Syriac|NotoSansSyriac-Regular_ExtraLight
Noto Sans Syriac Regular Light|Noto Sans Syriac|NotoSansSyriac-Regular_Light
Noto Sans Syriac Regular Medium|Noto Sans Syriac|NotoSansSyriac-Regular_Medium
Noto Sans Syriac Regular SemiBold|Noto Sans Syriac|NotoSansSyriac-Regular_SemiBold
Noto Sans Syriac Regular Thin|Noto Sans Syriac|NotoSansSyriac-Regular_Thin
Noto Sans Tagalog Regular|Noto Sans Tagalog|NotoSansTagalog-Regular
Noto Serif Myanmar Black|Noto Serif Myanmar|NotoSerifMyanmar-Black
Noto Serif Myanmar Bold|Noto Serif Myanmar|NotoSerifMyanmar-Bold
Noto Serif Myanmar ExtraBold|Noto Serif Myanmar|NotoSerifMyanmar-ExtraBold
Noto Serif Myanmar ExtraLight|Noto Serif Myanmar|NotoSerifMyanmar-ExtraLight
Noto Serif Myanmar Light|Noto Serif Myanmar|NotoSerifMyanmar-Light
Noto Serif Myanmar Medium|Noto Serif Myanmar|NotoSerifMyanmar-Medium
Noto Serif Myanmar Regular|Noto Serif Myanmar|NotoSerifMyanmar-Regular
Noto Serif Myanmar SemiBold|Noto Serif Myanmar|NotoSerifMyanmar-SemiBold
Noto Serif Myanmar Thin|Noto Serif Myanmar|NotoSerifMyanmar-Thin
Optima Bold|Optima|Optima-Bold
Optima Bold Italic|Optima|Optima-BoldItalic
Optima ExtraBlack|Optima|Optima-ExtraBlack
Optima Italic|Optima|Optima-Italic
Optima Regular|Optima|Optima-Regular
Oriya MN|Oriya MN|OriyaMN
Oriya MN Bold|Oriya MN|OriyaMN-Bold
Oriya Sangam MN|Oriya Sangam MN|OriyaSangamMN
Oriya Sangam MN Bold|Oriya Sangam MN|OriyaSangamMN-Bold
Osaka|Osaka|Osaka
Osaka-Mono|Osaka|Osaka-Mono
PT Mono Bold|PT Mono|PTMono-Bold
PT Mono|PT Mono|PTMono-Regular
PT Sans Bold|PT Sans|PTSans-Bold
PT Sans Bold Italic|PT Sans|PTSans-BoldItalic
PT Sans Caption|PT Sans Caption|PTSans-Caption
PT Sans Caption Bold|PT Sans Caption|PTSans-CaptionBold
PT Sans Italic|PT Sans|PTSans-Italic
PT Sans Narrow|PT Sans Narrow|PTSans-Narrow
PT Sans Narrow Bold|PT Sans Narrow|PTSans-NarrowBold
PT Sans|PT Sans|PTSans-Regular
PT Serif Bold|PT Serif|PTSerif-Bold
PT Serif Bold Italic|PT Serif|PTSerif-BoldItalic
PT Serif Caption|PT Serif Caption|PTSerif-Caption
PT Serif Caption Italic|PT Serif Caption|PTSerif-CaptionItalic
PT Serif Italic|PT Serif|PTSerif-Italic
PT Serif|PT Serif|PTSerif-Regular
Palatino Bold|Palatino|Palatino-Bold
Palatino Bold Italic|Palatino|Palatino-BoldItalic
Palatino Italic|Palatino|Palatino-Italic
Palatino|Palatino|Palatino-Roman
Papyrus|Papyrus|Papyrus
Papyrus Condensed|Papyrus|Papyrus-Condensed
Party LET Plain|Party LET|PartyLetPlain
Phosphate Inline|Phosphate|Phosphate-Inline
Phosphate Solid|Phosphate|Phosphate-Solid
苹方-港 细体|PingFang HK|PingFangHK-Light
苹方-港 中黑体|PingFang HK|PingFangHK-Medium
苹方-港 常规体|PingFang HK|PingFangHK-Regular
苹方-港 中粗体|PingFang HK|PingFangHK-Semibold
苹方-港 纤细体|PingFang HK|PingFangHK-Thin
苹方-港 极细体|PingFang HK|PingFangHK-Ultralight
苹方-澳 细体|PingFang MO|PingFangMO-Light
苹方-澳 中黑体|PingFang MO|PingFangMO-Medium
苹方-澳 常规体|PingFang MO|PingFangMO-Regular
苹方-澳 中粗体|PingFang MO|PingFangMO-Semibold
苹方-澳 纤细体|PingFang MO|PingFangMO-Thin
苹方-澳 极细体|PingFang MO|PingFangMO-Ultralight
苹方-简 细体|PingFang SC|PingFangSC-Light
苹方-简 中黑体|PingFang SC|PingFangSC-Medium
苹方-简 常规体|PingFang SC|PingFangSC-Regular
苹方-简 中粗体|PingFang SC|PingFangSC-Semibold
苹方-简 纤细体|PingFang SC|PingFangSC-Thin
苹方-简 极细体|PingFang SC|PingFangSC-Ultralight
苹方-繁 细体|PingFang TC|PingFangTC-Light
苹方-繁 中黑体|PingFang TC|PingFangTC-Medium
苹方-繁 常规体|PingFang TC|PingFangTC-Regular
苹方-繁 中粗体|PingFang TC|PingFangTC-Semibold
苹方-繁 纤细体|PingFang TC|PingFangTC-Thin
苹方-繁 极细体|PingFang TC|PingFangTC-Ultralight
Plantagenet Cherokee|Plantagenet Cherokee|PlantagenetCherokee
Raanana|Raanana|Raanana
Raanana Bold|Raanana|RaananaBold
Rockwell Bold|Rockwell|Rockwell-Bold
Rockwell Bold Italic|Rockwell|Rockwell-BoldItalic
Rockwell Italic|Rockwell|Rockwell-Italic
Rockwell|Rockwell|Rockwell-Regular
Hei Regular|Hei|SIL-Hei-Med-Jian
Kai Regular|Kai|SIL-Kai-Reg-Jian
报隶-简 常规体|Baoli SC|STBaoliSC-Regular
报隶-繁 常规体|Baoli TC|STBaoliTC-Regular
华文仿宋|STFangsong|STFangsong
华文黑体|STHeiti|STHeiti
黑体-简 细体|Heiti SC|STHeitiSC-Light
黑体-简 中等|Heiti SC|STHeitiSC-Medium
黑体-繁 细体|Heiti TC|STHeitiTC-Light
黑体-繁 中等|Heiti TC|STHeitiTC-Medium
STIX Two Math Regular|STIX Two Math|STIXTwoMath-Regular
STIX Two Text Regular|STIX Two Text|STIXTwoText
STIX Two Text Italic Italic|STIX Two Text|STIXTwoText-Italic
STIX Two Text Italic Bold Italic|STIX Two Text|STIXTwoText-Italic_Bold-Italic
STIX Two Text Italic Medium Italic|STIX Two Text|STIXTwoText-Italic_Medium-Italic
STIX Two Text Italic SemiBold Italic|STIX Two Text|STIXTwoText-Italic_SemiBold-Italic
STIX Two Text Bold|STIX Two Text|STIXTwoText_Bold
STIX Two Text Medium|STIX Two Text|STIXTwoText_Medium
STIX Two Text SemiBold|STIX Two Text|STIXTwoText_SemiBold
华文楷体|STKaiti|STKaiti
楷体-简 黑体|Kaiti SC|STKaitiSC-Black
楷体-简 粗体|Kaiti SC|STKaitiSC-Bold
楷体-简 常规体|Kaiti SC|STKaitiSC-Regular
楷体-繁 黑体|Kaiti TC|STKaitiTC-Black
楷体-繁 粗体|Kaiti TC|STKaitiTC-Bold
楷体-繁 常规体|Kaiti TC|STKaitiTC-Regular
隶变-简 常规体|Libian SC|STLibianSC-Regular
隶变-繁 常规体|Libian TC|STLibianTC-Regular
华文宋体|STSong|STSong
宋体-简 黑体|Songti SC|STSongti-SC-Black
宋体-简 粗体|Songti SC|STSongti-SC-Bold
宋体-简 细体|Songti SC|STSongti-SC-Light
宋体-简 常规体|Songti SC|STSongti-SC-Regular
宋体-繁 粗体|Songti TC|STSongti-TC-Bold
宋体-繁 细体|Songti TC|STSongti-TC-Light
宋体-繁 常规体|Songti TC|STSongti-TC-Regular
华文细黑|STHeiti|STXihei
行楷-简 粗体|Xingkai SC|STXingkaiSC-Bold
行楷-简 细体|Xingkai SC|STXingkaiSC-Light
行楷-繁 粗体|Xingkai TC|STXingkaiTC-Bold
行楷-繁 细体|Xingkai TC|STXingkaiTC-Light
圆体-简 粗体|Yuanti SC|STYuanti-SC-Bold
圆体-简 细体|Yuanti SC|STYuanti-SC-Light
圆体-简 常规体|Yuanti SC|STYuanti-SC-Regular
圆体-繁 粗体|Yuanti TC|STYuanti-TC-Bold
圆体-繁 细体|Yuanti TC|STYuanti-TC-Light
圆体-繁 常规体|Yuanti TC|STYuanti-TC-Regular
Sana Regular|Sana|Sana
Sathu|Sathu|Sathu
Savoye LET Plain:1.0|Savoye LET|SavoyeLetPlain
Shree Devanagari 714|Shree Devanagari 714|ShreeDev0714
Shree Devanagari 714 Bold|Shree Devanagari 714|ShreeDev0714-Bold
Shree Devanagari 714 Bold Italic|Shree Devanagari 714|ShreeDev0714-BoldItalic
Shree Devanagari 714 Italic|Shree Devanagari 714|ShreeDev0714-Italic
SignPainter-HouseScript|SignPainter|SignPainter-HouseScript
SignPainter-HouseScript Semibold|SignPainter|SignPainter-HouseScriptSemibold
Silom|Silom|Silom
简宋 粗体|SimSong|SimSong-Bold
简宋 常规体|SimSong|SimSong-Regular
Sinhala MN|Sinhala MN|SinhalaMN
Sinhala MN Bold|Sinhala MN|SinhalaMN-Bold
Sinhala Sangam MN|Sinhala Sangam MN|SinhalaSangamMN
Sinhala Sangam MN Bold|Sinhala Sangam MN|SinhalaSangamMN-Bold
Skia Regular|Skia|Skia-Regular
Skia Black|Skia|Skia-Regular_Black
Skia Black Condensed|Skia|Skia-Regular_Black-Condensed
Skia Black Extended|Skia|Skia-Regular_Black-Extended
Skia Bold|Skia|Skia-Regular_Bold
Skia Condensed|Skia|Skia-Regular_Condensed
Skia Extended|Skia|Skia-Regular_Extended
Skia Light|Skia|Skia-Regular_Light
Skia Light Condensed|Skia|Skia-Regular_Light-Condensed
Skia Light Extended|Skia|Skia-Regular_Light-Extended
Snell Roundhand|Snell Roundhand|SnellRoundhand
Snell Roundhand Black|Snell Roundhand|SnellRoundhand-Black
Snell Roundhand Bold|Snell Roundhand|SnellRoundhand-Bold
Sukhumvit Set Bold|Sukhumvit Set|SukhumvitSet-Bold
Sukhumvit Set Light|Sukhumvit Set|SukhumvitSet-Light
Sukhumvit Set Medium|Sukhumvit Set|SukhumvitSet-Medium
Sukhumvit Set Semi Bold|Sukhumvit Set|SukhumvitSet-SemiBold
Sukhumvit Set Text|Sukhumvit Set|SukhumvitSet-Text
Sukhumvit Set Thin|Sukhumvit Set|SukhumvitSet-Thin
Symbol|Symbol|Symbol
Tahoma|Tahoma|Tahoma
Tahoma Bold|Tahoma|Tahoma-Bold
Tamil MN|Tamil MN|TamilMN
Tamil MN Bold|Tamil MN|TamilMN-Bold
Tamil Sangam MN|Tamil Sangam MN|TamilSangamMN
Tamil Sangam MN Bold|Tamil Sangam MN|TamilSangamMN-Bold
Telugu MN|Telugu MN|TeluguMN
Telugu MN Bold|Telugu MN|TeluguMN-Bold
Telugu Sangam MN|Telugu Sangam MN|TeluguSangamMN
Telugu Sangam MN Bold|Telugu Sangam MN|TeluguSangamMN-Bold
Thonburi|Thonburi|Thonburi
Thonburi Bold|Thonburi|Thonburi-Bold
Thonburi Light|Thonburi|Thonburi-Light
Times New Roman Bold Italic|Times New Roman|TimesNewRomanPS-BoldItalicMT
Times New Roman Bold|Times New Roman|TimesNewRomanPS-BoldMT
Times New Roman Italic|Times New Roman|TimesNewRomanPS-ItalicMT
Times New Roman|Times New Roman|TimesNewRomanPSMT
Toppan Bunkyu Gothic Demibold|Toppan Bunkyu Gothic|ToppanBunkyuGothicPr6N-DB
Toppan Bunkyu Gothic Regular|Toppan Bunkyu Gothic|ToppanBunkyuGothicPr6N-Regular
Toppan Bunkyu Midashi Gothic Extrabold|Toppan Bunkyu Midashi Gothic|ToppanBunkyuMidashiGothicStdN-ExtraBold
Toppan Bunkyu Midashi Mincho Extrabold|Toppan Bunkyu Midashi Mincho|ToppanBunkyuMidashiMinchoStdN-ExtraBold
Toppan Bunkyu Mincho Regular|Toppan Bunkyu Mincho|ToppanBunkyuMinchoPr6N-Regular
Trattatello|Trattatello|Trattatello
Trebuchet MS Bold Italic|Trebuchet MS|Trebuchet-BoldItalic
Trebuchet MS|Trebuchet MS|TrebuchetMS
Trebuchet MS Bold|Trebuchet MS|TrebuchetMS-Bold
Trebuchet MS Italic|Trebuchet MS|TrebuchetMS-Italic
Tsukushi A Round Gothic Bold|Tsukushi A Round Gothic|TsukuARdGothic-Bold
Tsukushi A Round Gothic Regular|Tsukushi A Round Gothic|TsukuARdGothic-Regular
Tsukushi B Round Gothic Bold|Tsukushi B Round Gothic|TsukuBRdGothic-Bold
Tsukushi B Round Gothic Regular|Tsukushi B Round Gothic|TsukuBRdGothic-Regular
Verdana|Verdana|Verdana
Verdana Bold|Verdana|Verdana-Bold
Verdana Bold Italic|Verdana|Verdana-BoldItalic
Verdana Italic|Verdana|Verdana-Italic
Waseem Regular|Waseem|Waseem
Waseem Light|Waseem|WaseemLight
Webdings|Webdings|Webdings
魏碑-简 粗体|Weibei SC|WeibeiSC-Bold
魏碑-繁 粗体|Weibei TC|WeibeiTC-Bold
Wingdings|Wingdings|Wingdings-Regular
Wingdings 2|Wingdings 2|Wingdings2
Wingdings 3|Wingdings 3|Wingdings3
YuGothic Bold|YuGothic|YuGo-Bold
YuGothic Medium|YuGothic|YuGo-Medium
YuKyokasho Bold|YuKyokasho|YuKyo-Bold
YuKyokasho Medium|YuKyokasho|YuKyo-Medium
YuKyokasho Yoko Bold|YuKyokasho Yoko|YuKyo_Yoko-Bold
YuKyokasho Yoko Medium|YuKyokasho Yoko|YuKyo_Yoko-Medium
YuMincho Demibold|YuMincho|YuMin-Demibold
YuMincho Extrabold|YuMincho|YuMin-Extrabold
YuMincho Medium|YuMincho|YuMin-Medium
YuMincho +36p Kana Demibold|YuMincho +36p Kana|YuMin_36pKn-Demibold
YuMincho +36p Kana Extrabold|YuMincho +36p Kana|YuMin_36pKn-Extrabold
YuMincho +36p Kana Medium|YuMincho +36p Kana|YuMin_36pKn-Medium
雅痞-简 常规体|Yuppy SC|YuppySC-Regular
雅痞-繁 常规体|Yuppy TC|YuppyTC-Regular
Zapf Dingbats|Zapf Dingbats|ZapfDingbatsITC
Zapfino|Zapfino|Zapfino`;
  const lines = rows.split('\n');
  const proto = (typeof FontData === 'function' && FontData.prototype) || null;
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split('|');
    const row = Object.create(proto);
    row.fullName = parts[0] || '';
    row.family = parts[1] || '';
    row.postscriptName = parts[2] || '';
    _localFontRows.push(row);
  }
  return _localFontRows;
}
