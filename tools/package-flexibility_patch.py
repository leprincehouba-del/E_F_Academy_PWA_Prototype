from pathlib import Path
import re

app_path = Path('app.js')
index_path = Path('index.html')
app = app_path.read_text(encoding='utf-8')
index = index_path.read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

# --- index.html: add per-purchase session count control ---
pattern = re.compile(
    r'(<select id="packagePaymentStudent">.*?</select>\s*</label>)\s*(<div class="session-package-summary">)',
    re.S,
)
replacement = r'''\1

  <label>
    عدد الحصص المدفوعة مقدمًا
    <input
      id="packagePaymentSessions"
      type="number"
      min="1"
      max="100"
      step="1"
      inputmode="numeric"
      value="8"
    >
    <small>يمكن تسجيل 1 أو 2 أو 3 أو 4 حصص أو أي عدد حتى 100.</small>
  </label>

  \2'''
index, count = pattern.subn(replacement, index, count=1)
if count != 1:
    raise SystemExit('package purchase sessions input insertion failed')

index = replace_once(
    index,
    'سعر الباقة يُحسب تلقائيًا: عدد الحصص × سعر حصة مجموعة الطالب.',
    'عدد حصص الباقة الافتراضي قيمة مبدئية فقط؛ ويمكن تغيير عدد الحصص لكل طالب عند تسجيل كل باقة. السعر يُحسب تلقائيًا: عدد الحصص × سعر حصة مجموعة الطالب.',
    'settings package help'
)

# --- app.js: request token must also be tied to chosen session count ---
app = replace_once(
    app,
    'let sessionPackageRequestStudentId = "";\n',
    'let sessionPackageRequestStudentId = "";\nlet sessionPackageRequestSessions = 0;\n',
    'package request sessions state'
)

# Treat the new RPC as part of the package feature for clear migration errors.
app = replace_once(
    app,
    'message.includes("set_academy_billing_settings")',
    'message.includes("set_academy_billing_settings") ||\n    message.includes("purchase_student_session_package_custom")',
    'package feature missing detector'
)

# Initialize purchase input from settings without overwriting an in-progress manual edit.
settings_marker = '''    if ($("defaultPackageSessions")) {
      $("defaultPackageSessions").value =
        String(defaultPackageSessions);
    }

    syncStagePriceInputs();'''
settings_replacement = '''    if ($("defaultPackageSessions")) {
      $("defaultPackageSessions").value =
        String(defaultPackageSessions);
    }

    const purchaseSessionsInput = $("packagePaymentSessions");
    if (
      purchaseSessionsInput &&
      purchaseSessionsInput.dataset.userEdited !== "true"
    ) {
      purchaseSessionsInput.value = String(defaultPackageSessions);
    }

    syncStagePriceInputs();'''
app = replace_once(app, settings_marker, settings_replacement, 'package settings input init')

# Add helpers before the summary function.
summary_marker = 'function updateSessionPackageSummary() {'
helpers = '''function packagePurchaseSessionCount() {
  const input = $("packagePaymentSessions");
  const value = Number(input?.value || 0);

  if (!Number.isInteger(value) || value < 1 || value > 100) {
    return 0;
  }

  return value;
}

function resetPackagePurchaseSessionCount() {
  const input = $("packagePaymentSessions");
  if (!input) return;

  input.value = String(Math.max(1, Number(defaultPackageSessions || 8)));
  delete input.dataset.userEdited;
  sessionPackageRequestToken = "";
  sessionPackageRequestStudentId = "";
  sessionPackageRequestSessions = 0;
}

'''
if helpers not in app:
    app = replace_once(app, summary_marker, helpers + summary_marker, 'package helpers')

# Both summary and registration used the fixed default before. They now read the per-purchase input.
old_sessions = '''  const sessions = Math.max(
    1,
    Number(defaultPackageSessions || 8)
  );'''
if app.count(old_sessions) != 2:
    raise SystemExit(f'expected 2 fixed package session blocks, found {app.count(old_sessions)}')
app = app.replace(old_sessions, '  const sessions = packagePurchaseSessionCount();')

# Summary text and button safety for invalid count.
app = replace_once(
    app,
    '''  if ($("packageSessionsSummary")) {
    $("packageSessionsSummary").textContent =
      `${sessions} حصص`;
  }''',
    '''  if ($("packageSessionsSummary")) {
    $("packageSessionsSummary").textContent = sessions
      ? `${sessions} حصص`
      : "اختر عددًا من 1 إلى 100";
  }''',
    'package summary text'
)
app = replace_once(
    app,
    '    button.disabled = !student || unitPrice <= 0;',
    '    button.disabled = !student || unitPrice <= 0 || sessions <= 0;',
    'package summary button validation'
)

# Validate the selected count in registration before any request is sent.
register_anchor = '''  const amount = sessions * Number(group?.price || 0);

  if (!student || !group) {'''
register_replacement = '''  const amount = sessions * Number(group?.price || 0);

  if (!sessions) {
    showToast("اختر عدد حصص صحيحًا من 1 إلى 100");
    return;
  }

  if (!student || !group) {'''
app = replace_once(app, register_anchor, register_replacement, 'package count registration validation')

# A retry token is valid only for the same student AND same selected session count.
old_token_guard = '''  if (
    sessionPackageRequestStudentId &&
    sessionPackageRequestStudentId !== String(student.id)
  ) {
    sessionPackageRequestToken = "";
  }

  sessionPackageRequestStudentId = String(student.id);
  sessionPackageRequestToken =
    sessionPackageRequestToken || createPackageRequestToken();'''
new_token_guard = '''  if (
    (sessionPackageRequestStudentId &&
      sessionPackageRequestStudentId !== String(student.id)) ||
    (sessionPackageRequestSessions &&
      sessionPackageRequestSessions !== sessions)
  ) {
    sessionPackageRequestToken = "";
  }

  sessionPackageRequestStudentId = String(student.id);
  sessionPackageRequestSessions = sessions;
  sessionPackageRequestToken =
    sessionPackageRequestToken || createPackageRequestToken();'''
app = replace_once(app, old_token_guard, new_token_guard, 'package token guard')

# Call the new DB function with the chosen count. No fallback to the old fixed-size RPC.
old_rpc = '''    const { data, error } = await supabase.rpc(
      "purchase_student_session_package",
      {
        p_student_id: student.id,
        p_payment_method: method,
        p_request_token: sessionPackageRequestToken
      }
    );'''
new_rpc = '''    const { data, error } = await supabase.rpc(
      "purchase_student_session_package_custom",
      {
        p_student_id: student.id,
        p_payment_method: method,
        p_request_token: sessionPackageRequestToken,
        p_sessions: sessions
      }
    );'''
app = replace_once(app, old_rpc, new_rpc, 'custom package purchase rpc')

# Reset idempotency state and purchase count after a successful purchase.
app = replace_once(
    app,
    '''    sessionPackageRequestToken = "";
    sessionPackageRequestStudentId = "";

    await loadStudentSessionPackageBalances();''',
    '''    sessionPackageRequestToken = "";
    sessionPackageRequestStudentId = "";
    sessionPackageRequestSessions = 0;
    resetPackagePurchaseSessionCount();

    await loadStudentSessionPackageBalances();''',
    'package success reset'
)

# Opening package purchase from an attendance row starts from the configured default.
app = replace_once(
    app,
    '''  $("packagePaymentStudent").value = String(student.id);
  updateSessionPackageSummary();''',
    '''  $("packagePaymentStudent").value = String(student.id);
  resetPackagePurchaseSessionCount();
  updateSessionPackageSummary();''',
    'attendance package open reset'
)

# Student change starts a fresh transaction; session-count input updates summary immediately.
old_listener = '''$("packagePaymentStudent")?.addEventListener(
  "change",
  updateSessionPackageSummary
);'''
new_listener = '''$("packagePaymentStudent")?.addEventListener(
  "change",
  () => {
    resetPackagePurchaseSessionCount();
    updateSessionPackageSummary();
  }
);
$("packagePaymentSessions")?.addEventListener("input", event => {
  event.target.dataset.userEdited = "true";
  sessionPackageRequestToken = "";
  sessionPackageRequestSessions = 0;
  updateSessionPackageSummary();
});'''
app = replace_once(app, old_listener, new_listener, 'package input listeners')

app_path.write_text(app, encoding='utf-8')
index_path.write_text(index, encoding='utf-8')
