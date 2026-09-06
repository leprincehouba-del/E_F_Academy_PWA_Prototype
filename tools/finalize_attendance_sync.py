from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")

save_pos = text.index("async function saveAttendance(){")
start = text.index("    !window.confirm(\n", save_pos)
end_marker = "\n    )\n  ) {"
end = text.index(end_marker, start) + len("\n    )")

replacement = '''    !window.confirm(
      "تنبيه مهم: تاريخ الحصة المختار ليس تاريخ اليوم.\\n\\n" +
      `التاريخ المختار: ${selectedSessionDateForWarning}\\n` +
      `تاريخ اليوم: ${todayForAttendanceSave}\\n\\n` +
      "إذا كنت تسجل حصة قديمة عمدًا اضغط موافق، وإلا اضغط إلغاء وصحح التاريخ."
    )'''

text = text[:start] + replacement + text[end:]
path.write_text(text, encoding="utf-8")
