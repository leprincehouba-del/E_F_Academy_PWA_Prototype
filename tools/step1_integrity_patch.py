from pathlib import Path

path = Path('app.js')
text = path.read_text(encoding='utf-8')

start_marker = '    if(status==="present"){\n      s.present += 1; s.points += 3;'
end_marker = '\n  }\n\nconst pendingItems = ['
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('STEP1_MARKERS_NOT_FOUND')

safe_block = '''    if (dueBlocked) {
      blocked += 1;
    }

    const attendanceSaveResult = canEditAccount
      ? await supabase.rpc("save_safe_attendance_with_account", {
          p_session_id: sessionRow.id,
          p_student_id: s.id,
          p_attendance_status: persistedStatus,
          p_payment_status: payStatus,
          p_points_change: sessionPoints,
          p_points_details: pointsDetails,
          p_notes: null
        })
      : await supabase.rpc("save_safe_attendance", {
          p_session_id: sessionRow.id,
          p_student_id: s.id,
          p_attendance_status: persistedStatus,
          p_points_change: sessionPoints,
          p_points_details: pointsDetails,
          p_notes: null
        });

    if (attendanceSaveResult.error) {
      console.error(
        "Safe attendance error:",
        attendanceSaveResult.error
      );
      showToast("تعذر حفظ حضور الطالب؛ لم يتم إغلاق الحصة");
      return;
    }

    // عرض محلي فقط بعد نجاح الحفظ الآمن في قاعدة البيانات.
    // تسجيل الدفع الفعلي يتم داخل RPC نفسه حتى لا يتكرر عند إعادة المحاولة.
    if (
      isOwner &&
      isChargeableAttendance &&
      payStatus === "paid"
    ) {
      payments.unshift({
        studentId: s.id,
        amount: group.price,
        method: "نقدي",
        date: new Date().toISOString()
      });
    }

    sessionAttendance[s.id] = {
      status,
      payStatus,
      date: $("sessionDate").value
    };'''

text = text[:start] + safe_block + text[end:]

if 'points_balance: s.points' in text:
    raise SystemExit('STALE_ABSOLUTE_POINTS_WRITE_REMAINS')

path.write_text(text, encoding='utf-8')
