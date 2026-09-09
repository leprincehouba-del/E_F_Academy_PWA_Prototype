from pathlib import Path
import re

path = Path('app.js')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

# Avoid hidden dashboard network work when another page is active.
replace_once(
    'function renderAll(){\n  renderDashboard();',
    'function renderAll(){\n  if ($("dashboard")?.classList.contains("active-page")) {\n    renderDashboard();\n  }',
    'renderAll dashboard gate'
)

# Preserve group selection when a render rebuilds selects.
replace_once(
'''  ["groupSelect", "newGroup", "manageGroupSelect"].forEach(id => {
    if($(id)) $(id).innerHTML = groupOptions;
  });''',
'''  ["groupSelect", "newGroup", "manageGroupSelect"].forEach(id => {
    const element = $(id);
    if (!element) return;

    const previousValue = element.value;
    element.innerHTML = groupOptions;

    if (previousValue && [...element.options].some(
      option => String(option.value) === String(previousValue)
    )) {
      element.value = previousValue;
    }
  });''',
    'preserve group select'
)

# Package balances/settings are independent requests after student load.
replace_once(
'''  await loadStudentSessionPackageBalances();
  await loadSessionPackageSettings();
}''',
'''  await Promise.allSettled([
    loadStudentSessionPackageBalances(),
    loadSessionPackageSettings()
  ]);
}''',
    'parallel package metadata'
)

# Add a small bounded-concurrency utility, then use it for Walaa point queueing.
helper_marker = 'function showToast(message) {'
helper = '''async function mapWithConcurrency(items, limit, worker) {
  const list = Array.from(items || []);
  if (!list.length) return;

  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, list.length));
  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= list.length) return;
      await worker(list[index], index);
    }
  });

  await Promise.all(runners);
}

'''
replace_once(helper_marker, helper + helper_marker, 'insert concurrency helper')

start_marker = '    for (const entry of entries) {'
end_marker = '\n\n    renderManagerPointsStudents();'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Walaa loop markers not found')
block = text[start:end]
block = block.replace(
    start_marker,
    '    await mapWithConcurrency(entries, 4, async (entry) => {',
    1
)
block = block.replace('continue;', 'return;')
closing = block.rfind('    }')
if closing < 0:
    raise SystemExit('Walaa loop closing brace not found')
block = block[:closing] + '    });' + block[closing + 5:]
text = text[:start] + block + text[end:]

path.write_text(text, encoding='utf-8')
