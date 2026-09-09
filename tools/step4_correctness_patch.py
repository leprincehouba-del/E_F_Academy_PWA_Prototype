from pathlib import Path
import re

app_path = Path('app.js')
sw_path = Path('service-worker.js')
text = app_path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

# Keep all active weekly times on each group instead of relying on the first row.
replace_once(
'''      days: schedules.map((schedule) => schedule.day_name),
      time: schedules[0]?.start_time || group.start_time || "",''',
'''      days: schedules.map((schedule) => schedule.day_name),
      schedules: schedules.map(schedule => ({
        day_name: schedule.day_name,
        start_time: schedule.start_time,
        is_active: schedule.is_active !== false
      })),
      time: schedules[0]?.start_time || group.start_time || "",''',
    'retain weekly group schedules'
)

# Resolve a group's time from the actual selected session date.
replace_once(
'''function dayName(){
  return ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][new Date().getDay()];
}''',
'''function dayNameForDate(dateValue = localDateISO()) {
  const match = String(dateValue || "").match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date();

  return ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][date.getDay()];
}

function groupSessionStartTime(group, sessionDate = localDateISO()) {
  const targetDay = dayNameForDate(sessionDate);
  const schedule = Array.isArray(group?.schedules)
    ? group.schedules.find(item =>
        item?.is_active !== false &&
        String(item?.day_name || "") === String(targetDay)
      )
    : null;

  return schedule?.start_time || group?.time || "";
}

function dayName(){
  return dayNameForDate(localDateISO());
}''',
    'date-aware session time helper'
)

replace_once(
    'const startTime = normalizeSessionStartTime(group?.time);',
    '''const startTime = normalizeSessionStartTime(
    groupSessionStartTime(group, selectedDate)
  );''',
    'package same-day time'
)

# There are exactly two plain group.time session lookups: loadAttendance and saveAttendance.
plain = 'const startTime = normalizeSessionStartTime(group.time);'
if text.count(plain) != 2:
    raise SystemExit(f'attendance start-time uses: expected 2, found {text.count(plain)}')
text = text.replace(
    plain,
    '''const startTime = normalizeSessionStartTime(
    groupSessionStartTime(group, sessionDate)
  );'''
)

replace_once(
'''const expectedSessionTime =
  normalizeSessionStartTime(group.time);''',
'''const expectedSessionTime =
  normalizeSessionStartTime(
    groupSessionStartTime(group, selectedSessionDate)
  );''',
    'attendance historical time filter'
)

# UUIDs are strings; quote them in the two legacy inline WhatsApp handlers.
old_whatsapp = 'onclick="sendWhatsApp(${s.id})"'
if text.count(old_whatsapp) != 2:
    raise SystemExit(f'WhatsApp UUID handlers: expected 2, found {text.count(old_whatsapp)}')
text = text.replace(old_whatsapp, 'onclick="sendWhatsApp(\'${s.id}\')"')

# Repeated UI owner checks add network latency. Authentication already loaded the role;
# sensitive database RPCs still enforce server-side permissions.
patterns = [
    (
        r'''async function renderDashboard\(\)\{\n  const supabase = await getSupabase\(\);\n\n  const \{ data: isOwner, error: ownerCheckError \} =\n    await supabase\.rpc\("is_owner"\);\n\n  if \(ownerCheckError\) \{\n    console\.error\("Owner check error:", ownerCheckError\);\n    return;\n  \}''',
        '''async function renderDashboard(){
  const supabase = await getSupabase();
  const isOwner = currentAppRole === "owner";''',
        'dashboard owner network check'
    ),
    (
        r'''const \{ data: isOwner, error: ownerCheckError \} =\n  await supabase\.rpc\("is_owner"\);\n\nif \(!isCurrentAttendanceLoad\(\)\) return;\n\nif \(ownerCheckError\) \{\n  console\.error\("Owner check error:", ownerCheckError\);\n  showToast\("تعذر التحقق من صلاحية الحساب"\);\n  return;\n\}''',
        '''const isOwner = currentAppRole === "owner";

if (!isCurrentAttendanceLoad()) return;''',
        'attendance load owner network check'
    ),
    (
        r'''  const \{ data: isOwner, error: ownerCheckError \} =\n    await supabase\.rpc\("is_owner"\);\n\n  if \(ownerCheckError\) \{\n    console\.error\("Owner check error:", ownerCheckError\);\n    showToast\("تعذر التحقق من صلاحية الحساب"\);\n    return;\n  \}''',
        '''  const isOwner = currentAppRole === "owner";''',
        'attendance save owner network check'
    )
]
for pattern, replacement, label in patterns:
    text, count = re.subn(pattern, replacement, text, count=1)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')

app_path.write_text(text, encoding='utf-8')

# Service worker stays network-first for freshness, but cache writes no longer delay UI response.
sw = sw_path.read_text(encoding='utf-8')
if sw.count('const CACHE = "ef-academy-v42";') != 1:
    raise SystemExit('service worker v42 cache marker not found')
sw = sw.replace(
    'const CACHE = "ef-academy-v42";',
    'const CACHE = "ef-academy-v43";',
    1
)
old_cache = '''        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(e.request, response.clone());
        }

        return response;'''
new_cache = '''        if (response.ok) {
          const responseCopy = response.clone();
          caches
            .open(CACHE)
            .then(cache => cache.put(e.request, responseCopy))
            .catch(error => console.warn("Cache update failed:", error));
        }

        return response;'''
if sw.count(old_cache) != 1:
    raise SystemExit('blocking service-worker cache block not found')
sw = sw.replace(old_cache, new_cache, 1)
sw_path.write_text(sw, encoding='utf-8')
