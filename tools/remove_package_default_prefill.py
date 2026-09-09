from pathlib import Path
import re

app_path = Path('app.js')
index_path = Path('index.html')
app = app_path.read_text(encoding='utf-8')
index = index_path.read_text(encoding='utf-8')

# Purchase form should require an explicit count for each payment instead of silently
# inheriting the academy default. Keep the backend default for old-client compatibility.
pattern = r'(<input\s+id="packagePaymentSessions"[\s\S]*?)(\s+value="[^"]*")?([\s\S]*?>)'
match = re.search(pattern, index)
if not match:
    raise SystemExit('packagePaymentSessions input not found')
tag = match.group(0)
tag = re.sub(r'\s+value="[^"]*"', '', tag)
if 'placeholder=' not in tag:
    tag = tag[:-1] + '\n      placeholder="اكتب عدد الحصص"\n    >'
index = index[:match.start()] + tag + index[match.end():]

old_load = '''    const purchaseSessionsInput = $("packagePaymentSessions");
    if (
      purchaseSessionsInput &&
      purchaseSessionsInput.dataset.userEdited !== "true"
    ) {
      purchaseSessionsInput.value = String(defaultPackageSessions);
    }
'''
if old_load not in app:
    raise SystemExit('default package prefill block not found')
app = app.replace(old_load, '', 1)

old_reset = '''function resetPackagePurchaseSessionCount() {
  const input = $("packagePaymentSessions");
  if (!input) return;

  input.value = String(Math.max(1, Number(defaultPackageSessions || 8)));
  delete input.dataset.userEdited;
  sessionPackageRequestToken = "";'''
new_reset = '''function resetPackagePurchaseSessionCount() {
  const input = $("packagePaymentSessions");
  if (!input) return;

  input.value = "";
  delete input.dataset.userEdited;
  sessionPackageRequestToken = "";'''
if old_reset not in app:
    raise SystemExit('package reset function not found')
app = app.replace(old_reset, new_reset, 1)

old_total = '''  if ($("packageTotalAmount")) {
    $("packageTotalAmount").textContent =
      `${totalAmount.toFixed(2)} جنيه`;
  }'''
new_total = '''  if ($("packageTotalAmount")) {
    $("packageTotalAmount").textContent = sessions
      ? `${totalAmount.toFixed(2)} جنيه`
      : "—";
  }'''
if old_total not in app:
    raise SystemExit('package total display block not found')
app = app.replace(old_total, new_total, 1)

app_path.write_text(app, encoding='utf-8')
index_path.write_text(index, encoding='utf-8')
