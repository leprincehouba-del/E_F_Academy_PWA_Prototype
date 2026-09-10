from pathlib import Path

path = Path('app.js')
app = path.read_text(encoding='utf-8')

old = '''function lessonFullSpeechText(lesson) {
  const vocabulary = normalizeLessonVocabulary(
    lesson?.vocabulary
  ).map(item => item.english);
  const sentences = lessonSplitSentences(
    lesson?.reading_text
  );

  return [...vocabulary, ...sentences].join(". ");
}

function parentLessonCardMarkup(lesson, badgeLabel = "") {
  const vocabulary = normalizeLessonVocabulary(
    lesson.vocabulary
  );
  const sentences = lessonSplitSentences(
    lesson.reading_text
  );
'''

new = '''function lessonParentDisplayContent(lesson) {
  const rawVocabulary = normalizeLessonVocabulary(
    lesson?.vocabulary
  );
  const vocabulary = [];
  const recoveredReading = [];
  const sentenceSignals = /\\b(?:i|you|he|she|it|we|they|this|that|these|those|is|am|are|was|were|has|have|can|will|do|does|did|my|your|his|her|our|their)\\b/i;

  rawVocabulary.forEach(item => {
    const english = String(item?.english || "").trim();
    const words = english.match(/[A-Za-z]+(?:['’\\-][A-Za-z]+)*/g) || [];

    if (!english || !words.length) return;
    if (lessonOcrLooksLikeNoise(english, english, words)) return;

    const isVocabulary =
      words.length <= 3 &&
      english.length <= 60 &&
      !/[.!?:;]$/.test(english) &&
      !sentenceSignals.test(english);

    if (isVocabulary) {
      vocabulary.push(item);
    } else {
      recoveredReading.push(english);
    }
  });

  const seenSentences = new Set();
  const sentences = [
    ...recoveredReading,
    ...lessonSplitSentences(lesson?.reading_text)
  ].filter(sentence => {
    const key = lessonOcrLineKey(sentence);
    if (!key || seenSentences.has(key)) return false;
    seenSentences.add(key);
    return true;
  });

  return { vocabulary, sentences };
}

function lessonFullSpeechText(lesson) {
  const { vocabulary, sentences } = lessonParentDisplayContent(lesson);

  return [
    ...vocabulary.map(item => item.english),
    ...sentences
  ].join(". ");
}

function parentLessonCardMarkup(lesson, badgeLabel = "") {
  const { vocabulary, sentences } = lessonParentDisplayContent(lesson);
'''

if old not in app:
    raise SystemExit('lessonFullSpeechText/parentLessonCardMarkup block not found')

app = app.replace(old, new, 1)
path.write_text(app, encoding='utf-8')
print('Existing parent lesson cleanup patch applied')
