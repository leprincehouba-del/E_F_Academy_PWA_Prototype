from pathlib import Path

APP = Path('app.js')
CSS = Path('styles.css')
SW = Path('service-worker.js')

app = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')
sw = SW.read_text(encoding='utf-8')

old_pdf_helper = '''function lessonOcrHasUsefulPdfText(value) {
  return (String(value || "").match(/[A-Za-z]/g) || []).length >= 20;
}
'''
new_pdf_helper = '''function lessonOcrHasUsefulPdfText(value) {
  const text = cleanLessonOcrText(value);
  const englishLetters = (text.match(/[A-Za-z]/g) || []).length;

  // A tiny selectable PDF text layer is often only a header/footer while
  // the real worksheet is an embedded image. Only trust a reasonably dense
  // text layer when the page has no raster images.
  return englishLetters >= 160 && text.length >= 220;
}

function lessonOcrLineKey(value) {
  return String(value || "")
    .toLocaleLowerCase("en")
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9\\u0600-\\u06ff]+/g, "")
    .trim();
}

function mergeLessonOcrSources(...values) {
  const seen = new Set();
  const lines = [];

  values.forEach(value => {
    cleanLessonOcrText(value)
      .split(/\\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .forEach(line => {
        const key = lessonOcrLineKey(line);
        if (!key || seen.has(key)) return;
        seen.add(key);
        lines.push(line);
      });
  });

  return lines.join("\\n");
}

async function lessonOcrPdfPageHasImages(
  pdfDocument,
  pageNumber,
  pdfModule
) {
  const page = await pdfDocument.getPage(pageNumber);

  try {
    const operatorList = await page.getOperatorList();
    const ops = pdfModule?.OPS || {};
    const imageOps = new Set(
      [
        ops.paintImageXObject,
        ops.paintInlineImageXObject,
        ops.paintImageMaskXObject,
        ops.paintSolidColorImageMask
      ].filter(value => Number.isFinite(value))
    );

    // If this PDF.js build does not expose image operation constants, prefer
    // OCR rather than risk silently missing text that lives inside an image.
    if (!imageOps.size) return true;

    return (operatorList?.fnArray || []).some(fn => imageOps.has(fn));
  } finally {
    page.cleanup();
  }
}
'''
if old_pdf_helper not in app:
    raise SystemExit('lessonOcrHasUsefulPdfText block not found')
app = app.replace(old_pdf_helper, new_pdf_helper, 1)

old_organize_prefix = '''function organizeLessonOcrText(value) {
  const lines = cleanLessonOcrText(value)
    .split(/\\n+/)
    .map(line => line.trim())
    .filter(Boolean);
'''
new_organize_prefix = '''function lessonOcrLooksLikeInstruction(english, words) {
  const normalized = String(english || "")
    .toLocaleLowerCase("en")
    .replace(/\\s+/g, " ")
    .trim();

  if (!normalized || !Array.isArray(words)) return false;

  const startsWithInstruction = /^(?:look|read|write|choose|circle|match|complete|unscramble|change|listen|answer|number|fill|tick|underline|rearrange|correct|put|copy|colour|color)\\b/.test(
    normalized
  );

  return startsWithInstruction &&
    words.length <= 12 &&
    (!/[.!?]$/.test(normalized) || /[:;]$/.test(normalized));
}

function lessonOcrLooksLikeNoise(line, english, words) {
  const source = String(line || "").trim();
  const normalized = String(english || "")
    .toLocaleLowerCase("en")
    .replace(/[’‘]/g, "'")
    .replace(/\\s+/g, " ")
    .trim();
  const digitCount = (source.match(/\\d/g) || []).length;

  if (!normalized) return true;

  // Phone numbers / contact lines should never become lesson vocabulary.
  if (digitCount >= 7) return true;

  // Common academy/teacher headers seen on worksheets.
  if (/\\b(?:mr\\.?\\s*)?mohamed\\s+mahmoud\\b/i.test(normalized)) {
    return true;
  }
  if (/^(?:e\\.?\\s*f\\.?|ef)$/i.test(normalized)) return true;
  if (/^(?:primary|prep|secondary|grade|kg)\\s*\\d*[a-z\\s.-]*$/i.test(normalized)) {
    return true;
  }
  if (/^(?:page|unit|lesson|worksheet|exercise|exercises)\\s*\\d*\\s*$/i.test(normalized)) {
    return true;
  }
  if (/^(?:singular\\s+plural|plural\\s+singular|words?|vocabulary|grammar)$/i.test(normalized)) {
    return true;
  }

  return lessonOcrLooksLikeInstruction(english, words);
}

function organizeLessonOcrText(value) {
  const lines = cleanLessonOcrText(value)
    .split(/\\n+/)
    .map(line => line.trim())
    .filter(Boolean);
'''
if old_organize_prefix not in app:
    raise SystemExit('organizeLessonOcrText prefix not found')
app = app.replace(old_organize_prefix, new_organize_prefix, 1)

old_classification = '''    if (!english || words.join("").length < 2) return;

    const looksLikeShortEntry =
      words.length <= 7 &&
      english.length <= 100 &&
      !/[.!?]$/.test(english);
    const looksLikeTranslatedEntry =
      Boolean(arabic) &&
      words.length <= 12 &&
      english.length <= 180;

    if (looksLikeShortEntry || looksLikeTranslatedEntry) {
'''
new_classification = '''    if (!english || words.join("").length < 2) return;
    if (lessonOcrLooksLikeNoise(line, english, words)) return;

    const sentenceSignals = /\\b(?:i|you|he|she|it|we|they|this|that|these|those|is|am|are|was|were|has|have|can|will|do|does|did|my|your|his|her|our|their)\\b/i;
    const looksLikeVocabularyEntry =
      words.length <= 3 &&
      english.length <= 60 &&
      !/[.!?:;]$/.test(english) &&
      !sentenceSignals.test(english);
    const looksLikeTranslatedEntry =
      Boolean(arabic) &&
      words.length <= 8 &&
      english.length <= 120 &&
      !lessonOcrLooksLikeInstruction(english, words);

    if (looksLikeVocabularyEntry || looksLikeTranslatedEntry) {
'''
if old_classification not in app:
    raise SystemExit('OCR classification block not found')
app = app.replace(old_classification, new_classification, 1)

old_pdf_loop = '''        const directText = await lessonOcrPdfPageText(
          pdfDocument,
          pageNumber
        );

        if (lessonOcrHasUsefulPdfText(directText)) {
          extractedSections.push(`صفحة ${pageNumber}\\n${directText}`);
          completedUnits += 1;
          setLessonOcrProgress(
            `تمت قراءة صفحة ${pageNumber} مباشرة`,
            (completedUnits / totalUnits) * 100
          );
          continue;
        }

        const activeWorker = await ensureOcrWorker();
        const canvas = await lessonOcrPdfPageCanvas(
          pdfDocument,
          pageNumber
        );
        const result = await activeWorker.recognize(canvas);
        extractedSections.push(
          `صفحة ${pageNumber}\\n${result?.data?.text || ""}`
        );
        completedUnits += 1;
'''
new_pdf_loop = '''        const directText = await lessonOcrPdfPageText(
          pdfDocument,
          pageNumber
        );
        const pageHasImages = await lessonOcrPdfPageHasImages(
          pdfDocument,
          pageNumber,
          pdfModule
        );
        const shouldRunOcr =
          pageHasImages || !lessonOcrHasUsefulPdfText(directText);

        if (!shouldRunOcr) {
          extractedSections.push(`صفحة ${pageNumber}\\n${directText}`);
          completedUnits += 1;
          setLessonOcrProgress(
            `تمت قراءة صفحة ${pageNumber} مباشرة`,
            (completedUnits / totalUnits) * 100
          );
          continue;
        }

        const activeWorker = await ensureOcrWorker();
        const canvas = await lessonOcrPdfPageCanvas(
          pdfDocument,
          pageNumber
        );
        const result = await activeWorker.recognize(canvas);
        const ocrText = result?.data?.text || "";
        const mergedText = mergeLessonOcrSources(
          directText,
          ocrText
        );
        extractedSections.push(
          `صفحة ${pageNumber}\\n${mergedText}`
        );
        completedUnits += 1;
'''
if old_pdf_loop not in app:
    raise SystemExit('PDF OCR loop block not found')
app = app.replace(old_pdf_loop, new_pdf_loop, 1)

old_vocab_markup = '''      ${vocabulary.length
        ? `
          <section class="lesson-content-section">
            <h3>الكلمات والعبارات</h3>
            <div class="lesson-vocabulary-grid">
              ${vocabulary.map(item => `
                <button
                  type="button"
                  class="lesson-speak-item lesson-word-card"
                  data-lesson-speak="${escapeHtml(item.english)}"
                >
                  <span class="lesson-speaker-icon" aria-hidden="true">🔊</span>
                  <strong lang="en">${escapeHtml(item.english)}</strong>
                  ${item.arabic
                    ? `<small>${escapeHtml(item.arabic)}</small>`
                    : ""}
                </button>
              `).join("")}
            </div>
          </section>
        `
        : ""}

      ${sentences.length
        ? `
          <section class="lesson-content-section">
            <h3>الجمل والنص</h3>
            <div class="lesson-sentence-list">
'''
new_vocab_markup = '''      ${vocabulary.length
        ? `
          <section class="lesson-content-section">
            <h3>الكلمات والعبارات</h3>
            <p class="lesson-content-hint">
              اضغط على أي كلمة لسماعها، أو على 🔊 لسماع العبارة كاملة.
            </p>
            <div class="lesson-vocabulary-grid">
              ${vocabulary.map(item => `
                <div class="lesson-word-card">
                  <button
                    type="button"
                    class="lesson-vocabulary-play"
                    data-lesson-speak="${escapeHtml(item.english)}"
                    aria-label="تشغيل الكلمة أو العبارة كاملة"
                    title="تشغيل الكلمة أو العبارة كاملة"
                  >🔊</button>
                  <div class="lesson-vocabulary-text" lang="en" dir="ltr">
                    ${lessonInteractiveSentenceMarkup(item.english)}
                  </div>
                  ${item.arabic
                    ? `<small>${escapeHtml(item.arabic)}</small>`
                    : ""}
                </div>
              `).join("")}
            </div>
          </section>
        `
        : ""}

      ${sentences.length
        ? `
          <section class="lesson-content-section">
            <h3>النص والجمل</h3>
            <p class="lesson-content-hint">
              اضغط على أي كلمة داخل النص لسماعها منفردة، أو على 🔊 لسماع الجملة كاملة.
            </p>
            <div class="lesson-sentence-list">
'''
if old_vocab_markup not in app:
    raise SystemExit('parent vocabulary markup block not found')
app = app.replace(old_vocab_markup, new_vocab_markup, 1)

css_marker = '/* Lesson content: make individual-word audio obvious */'
if css_marker not in css:
    css += '''\n\n/* Lesson content: make individual-word audio obvious */
.lesson-content-hint{
  margin:2px 0 9px;
  color:var(--muted);
  font-size:12px;
  line-height:1.6;
}
.lesson-word-card{
  position:relative;
  min-width:0;
  border:1px solid var(--line);
  border-radius:13px;
  padding:12px 44px 12px 12px;
  background:#fff;
  color:var(--ink);
  text-align:left;
  direction:ltr;
}
.lesson-vocabulary-play{
  position:absolute;
  top:50%;
  right:9px;
  transform:translateY(-50%);
  width:30px;
  height:30px;
  display:grid;
  place-items:center;
  padding:0;
  border:1px solid rgba(13,91,67,.15);
  border-radius:9px;
  background:var(--green-3);
  color:var(--green);
}
.lesson-vocabulary-play:hover,
.lesson-vocabulary-play:focus-visible,
.lesson-vocabulary-play.speaking{
  border-color:var(--green);
  background:#dff2e9;
}
.lesson-vocabulary-text{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:3px;
  color:var(--green);
  font-size:17px;
  font-weight:800;
  line-height:1.6;
}
.lesson-word-card small{
  display:block;
  margin-top:5px;
  color:var(--muted);
  direction:rtl;
  text-align:right;
}
.lesson-inline-word{
  display:inline-block;
  margin:1px;
  border:1px solid rgba(13,91,67,.16);
  border-radius:7px;
  padding:2px 5px;
  background:#f7fbf9;
  color:var(--green);
  font-weight:800;
  cursor:pointer;
}
.lesson-inline-word:hover,
.lesson-inline-word:focus-visible,
.lesson-inline-word.speaking{
  border-color:var(--green);
  background:#dff2e9;
  color:var(--green);
}
@media(max-width:560px){
  .lesson-word-card{
    padding:10px 38px 10px 8px;
  }
  .lesson-vocabulary-play{
    right:6px;
    width:28px;
    height:28px;
  }
  .lesson-vocabulary-text{
    font-size:14px;
  }
  .lesson-inline-word{
    padding:2px 4px;
  }
}
'''

if 'const CACHE = "ef-academy-v43";' not in sw:
    raise SystemExit('expected service worker cache v43 not found')
sw = sw.replace(
    'const CACHE = "ef-academy-v43";',
    'const CACHE = "ef-academy-v44";',
    1
)

APP.write_text(app, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
SW.write_text(sw, encoding='utf-8')

print('Lesson content quality patch applied successfully')
