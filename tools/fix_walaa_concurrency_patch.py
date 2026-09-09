from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")
start_marker = "    await mapWithConcurrency(entries, 5, async (entry) => {"
end_marker = "\n\n    renderManagerPointsStudents();"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("Walaa concurrent worker block not found")
block = text[start:end]
block = block.replace("continue;", "return;")
text = text[:start] + block + text[end:]
path.write_text(text, encoding="utf-8")
