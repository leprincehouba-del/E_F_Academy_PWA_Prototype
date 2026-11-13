import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@1";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY =
  Deno.env.get("VAPID_PUBLIC_KEY");

const VAPID_PRIVATE_KEY =
  Deno.env.get("VAPID_PRIVATE_KEY");

const VAPID_SUBJECT =
  Deno.env.get("SUPABASE_URL");

if (
  !VAPID_PUBLIC_KEY ||
  !VAPID_PRIVATE_KEY ||
  !VAPID_SUBJECT
) {
  throw new Error("VAPID configuration is missing");
}

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

function phoneKey(value: unknown) {
  let phone = String(value || "")
    .replace(/[^\d]/g, "");

  if (phone.startsWith("0020")) {
    phone = phone.slice(4);
  } else if (
    phone.startsWith("20") &&
    phone.length >= 12
  ) {
    phone = phone.slice(2);
  }

  if (
    !phone.startsWith("0") &&
    phone.length === 10
  ) {
    phone = "0" + phone;
  }

  return phone;
}

function attendanceLabel(status: string, details: unknown = []) {
  const veryLate = Array.isArray(details) && details.some((detail: any) => {
    const reason = String(
      detail?.reason || detail?.reason_key || detail?.reason_label || ""
    ).toLowerCase().replace(/[\s_-]+/g, "");
    return reason === "verylate" || reason === "متأخرجدًا" || reason === "متأخرجدا";
  });

  if (status === "late" && veryLate) {
    return "متأخر جدًا";
  }

  const labels: Record<string, string> = {
    present: "حاضر",
    late: "متأخر",
    absent: "غائب",
    excused: "غياب بعذر"
  };

  return labels[status] || status;
}

function paymentLabel(
  attendanceStatus: string,
  paymentStatus: string,
  chargeAmount: number
) {
  if (
    attendanceStatus === "absent" ||
    attendanceStatus === "excused"
  ) {
    return "لا توجد رسوم على الحصة";
  }

  if (paymentStatus === "paid") {
    return "تم الدفع";
  }

  if (paymentStatus === "due") {
    return `آجل ${Number(chargeAmount || 0).toFixed(2)} جنيه`;
  }

  if (paymentStatus === "free") {
    return "معفي من الدفع";
  }

  return paymentStatus || "";
}

function reasonLabel(detail: any) {
  const raw = String(
    detail?.reason_label ||
    detail?.reason_text ||
    detail?.reason ||
    "نقاط"
  ).trim();

  const key = raw
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  const labels: Record<string, string> = {
    attendance: "الحضور",
    attendancepoints: "الحضور",
    present: "الحضور",
    absence: "الغياب",
    absent: "الغياب",
    late: "التأخير",
    verylate: "متأخر جدًا",
    delay: "التأخير",
    homework: "الواجب",
    homeworkdone: "الواجب",
    participation: "المشاركة",
    classparticipation: "المشاركة",
    oralrecitation: "التسميع الشفوي",
    writtenrecitation: "التسميع التحريري",
    recitation: "التسميع",
    activity: "النشاط",
    quiz: "الاختبار",
    exam: "الامتحان",
    behavior: "السلوك",
    manual: "النقاط",
    bonus: "نقاط إضافية",
    penalty: "خصم نقاط"
  };

  return labels[key] || raw;
}

function pointsDetailsText(details: unknown) {
  if (!Array.isArray(details) || details.length === 0) {
    return "";
  }

  return details
    .map((detail: any) => {
      const value = Number(
        detail?.value ??
        detail?.points ??
        0
      );

      const sign = value > 0 ? "+" : "";
      return `${reasonLabel(detail)} ${sign}${value}`;
    })
    .join("، ");
}

async function prepareDeliveryContext(
  ctx: any,
  studentRows: any[]
) {
  const {
    data: profiles,
    error: profilesError
  } = await ctx.supabaseAdmin
    .from("user_profiles")
    .select("id, phone")
    .eq("role", "parent")
    .eq("is_active", true)
    .not("phone", "is", null);

  if (profilesError) {
    throw profilesError;
  }

  const profileByPhone = new Map(
    (profiles || []).map((profile: any) => [
      phoneKey(profile.phone),
      profile
    ])
  );

  const parentUserIds = [
    ...new Set(
      (studentRows || [])
        .map((student: any) => {
          const profile = profileByPhone.get(
            phoneKey(student.parent_phone)
          );
          return profile?.id;
        })
        .filter(Boolean)
    )
  ];

  let subscriptions: any[] = [];

  if (parentUserIds.length > 0) {
    const { data, error } = await ctx.supabaseAdmin
      .from("push_subscriptions")
      .select("user_id, endpoint, subscription")
      .in("user_id", parentUserIds);

    if (error) throw error;
    subscriptions = data || [];
  }

  const subscriptionsByUser =
    new Map<string, any[]>();

  for (const subscription of subscriptions) {
    const list = subscriptionsByUser.get(
      subscription.user_id
    ) || [];

    list.push(subscription);
    subscriptionsByUser.set(
      subscription.user_id,
      list
    );
  }

  return {
    profileByPhone,
    subscriptionsByUser
  };
}

async function deliverOne(
  ctx: any,
  deliveryContext: any,
  student: any,
  title: string,
  message: string,
  linkage: {
    session_id?: string;
    homework_assignment_id?: string;
  }
) {
  const parentPhone = student.parent_phone || "";

  const {
    data: notification,
    error: notificationError
  } = await ctx.supabaseAdmin
    .from("notifications")
    .insert({
      student_id: student.id,
      parent_phone: parentPhone,
      channel: "in_app",
      title,
      body: message,
      status: "pending",
      ...linkage
    })
    .select("id")
    .single();

  if (notificationError) {
    console.error(
      "Notification insert error:",
      notificationError
    );
  }

  const parentProfile =
    deliveryContext.profileByPhone.get(
      phoneKey(parentPhone)
    );

  if (!parentProfile) {
    return {
      sent: 0,
      failed: 0,
      withoutSubscription: 1
    };
  }

  const parentSubscriptions =
    deliveryContext.subscriptionsByUser.get(
      parentProfile.id
    ) || [];

  if (parentSubscriptions.length === 0) {
    return {
      sent: 0,
      failed: 0,
      withoutSubscription: 1
    };
  }

  const payload = JSON.stringify({
    title,
    body: message,
    url: "./"
  });

  let sent = 0;
  let failed = 0;

  for (const row of parentSubscriptions) {
    try {
      await webpush.sendNotification(
        row.subscription,
        payload,
        {
          TTL: 300,
          urgency: "high"
        }
      );

      sent += 1;
    } catch (error) {
      failed += 1;

      console.error(
        "Push send error:",
        error
      );

      const statusCode = Number(
        (error as any)?.statusCode || 0
      );

      if (
        statusCode === 404 ||
        statusCode === 410
      ) {
        await ctx.supabaseAdmin
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", row.endpoint);
      }
    }
  }

  if (notification?.id) {
    if (sent > 0) {
      await ctx.supabaseAdmin
        .from("notifications")
        .update({
          status: "sent",
          sent_at: new Date().toISOString()
        })
        .eq("id", notification.id);
    } else if (failed > 0) {
      await ctx.supabaseAdmin
        .from("notifications")
        .update({ status: "failed" })
        .eq("id", notification.id);
    }
  }

  return {
    sent,
    failed,
    withoutSubscription: 0
  };
}

export default {
  fetch: withSupabase(
    { auth: "user" },

    async (req, ctx) => {
      try {
        const {
          data: { user },
          error: userError
        } = await ctx.supabase.auth.getUser();

        if (userError || !user) {
          return Response.json(
            {
              ok: false,
              error: "User not found"
            },
            { status: 401 }
          );
        }

        let requestBody: {
          session_id?: string;
          homework_assignment_id?: string;
        } = {};

        try {
          requestBody = await req.json();
        } catch {
          requestBody = {};
        }

        const sessionId = requestBody.session_id;
        const homeworkAssignmentId =
          requestBody.homework_assignment_id;

        if (!sessionId && !homeworkAssignmentId) {
          return Response.json(
            {
              ok: false,
              error:
                "session_id or homework_assignment_id is required"
            },
            { status: 400 }
          );
        }

        const {
          data: callerProfile,
          error: callerError
        } = await ctx.supabaseAdmin
          .from("user_profiles")
          .select("role, is_active")
          .eq("id", user.id)
          .maybeSingle();

        if (callerError) throw callerError;

        if (
          !callerProfile ||
          callerProfile.is_active !== true
        ) {
          return Response.json(
            {
              ok: false,
              error: "Not allowed"
            },
            { status: 403 }
          );
        }

        let permissions: Record<string, any> = {};

        if (callerProfile.role === "manager") {
          const {
            data: permissionRow,
            error: permissionError
          } = await ctx.supabaseAdmin
            .from("manager_permissions")
            .select("permissions")
            .eq("user_id", user.id)
            .maybeSingle();

          if (permissionError) {
            throw permissionError;
          }

          permissions =
            permissionRow?.permissions || {};
        } else if (callerProfile.role !== "owner") {
          return Response.json(
            {
              ok: false,
              error: "Not allowed"
            },
            { status: 403 }
          );
        }

        if (sessionId) {
          if (
            callerProfile.role === "manager" &&
            permissions.attendance_edit !== true
          ) {
            return Response.json(
              {
                ok: false,
                error:
                  "Attendance edit permission required"
              },
              { status: 403 }
            );
          }

          const {
            data: attendanceRows,
            error: attendanceError
          } = await ctx.supabaseAdmin
            .from("attendance")
            .select(`
              student_id,
              attendance_status,
              payment_status,
              charge_amount,
              points_change,
              points_details
            `)
            .eq("session_id", sessionId);

          if (attendanceError) {
            throw attendanceError;
          }

          if (
            !attendanceRows ||
            attendanceRows.length === 0
          ) {
            return Response.json({
              ok: true,
              sent: 0,
              failed: 0,
              message: "No attendance rows"
            });
          }

          const studentIds = [
            ...new Set(
              attendanceRows
                .map((row: any) => row.student_id)
                .filter(Boolean)
            )
          ];

          const {
            data: studentRows,
            error: studentsError
          } = await ctx.supabaseAdmin
            .from("students")
            .select(
              "id, full_name, parent_phone, points_balance"
            )
            .in("id", studentIds);

          if (studentsError) {
            throw studentsError;
          }

          const studentById = new Map(
            (studentRows || []).map((student: any) => [
              student.id,
              student
            ])
          );

          const {
            data: alreadySentRows,
            error: alreadySentError
          } = await ctx.supabaseAdmin
            .from("notifications")
            .select("student_id")
            .eq("session_id", sessionId)
            .eq("status", "sent");

          if (alreadySentError) {
            console.error(
              "Existing notification check error:",
              alreadySentError
            );
          }

          const alreadySent = new Set(
            (alreadySentRows || []).map(
              (row: any) => String(row.student_id)
            )
          );

          const deliveryContext =
            await prepareDeliveryContext(
              ctx,
              studentRows || []
            );

          let sent = 0;
          let failed = 0;
          let withoutSubscription = 0;
          let skippedAlreadySent = 0;

          for (const attendance of attendanceRows) {
            const student = studentById.get(
              attendance.student_id
            );

            if (!student) continue;

            if (alreadySent.has(String(student.id))) {
              skippedAlreadySent += 1;
              continue;
            }

            const title =
              `حصة ${student.full_name}`;

            const points = Number(
              attendance.points_change || 0
            );

            const pointsText =
              points > 0 ? `+${points}` : `${points}`;

            const details = pointsDetailsText(
              attendance.points_details
            );

            const detailsPart = details
              ? ` • التفاصيل: ${details}`
              : "";

            const message =
              `الحضور: ${attendanceLabel(
                attendance.attendance_status,
                attendance.points_details
              )} • ` +
              `${paymentLabel(
                attendance.attendance_status,
                attendance.payment_status,
                attendance.charge_amount
              )} • ` +
              `نقاط الحصة: ${pointsText}` +
              detailsPart +
              ` • إجمالي النقاط: ${Number(
                student.points_balance || 0
              )}`;

            const result = await deliverOne(
              ctx,
              deliveryContext,
              student,
              title,
              message,
              { session_id: sessionId }
            );

            sent += result.sent;
            failed += result.failed;
            withoutSubscription +=
              result.withoutSubscription;
          }

          return Response.json({
            ok: failed === 0,
            session_id: sessionId,
            students: attendanceRows.length,
            sent,
            failed,
            without_subscription:
              withoutSubscription,
            skipped_already_sent:
              skippedAlreadySent
          });
        }

        // Homework push branch.
        if (
          callerProfile.role === "manager" &&
          permissions.attendance_edit !== true &&
          permissions.points_edit !== true
        ) {
          return Response.json(
            {
              ok: false,
              error:
                "Homework permission required"
            },
            { status: 403 }
          );
        }

        const {
          data: assignment,
          error: assignmentError
        } = await ctx.supabaseAdmin
          .from("homework_assignments")
          .select(`
            id,
            grade_key,
            title,
            homework_date,
            homework_files ( id )
          `)
          .eq("id", homeworkAssignmentId)
          .eq("is_active", true)
          .single();

        if (assignmentError || !assignment) {
          throw assignmentError ||
            new Error("Homework assignment not found");
        }

        const {
          data: gradeGroups,
          error: gradeGroupsError
        } = await ctx.supabaseAdmin
          .from("groups")
          .select("id")
          .eq("grade", assignment.grade_key)
          .eq("is_active", true);

        if (gradeGroupsError) {
          throw gradeGroupsError;
        }

        const groupIds = (gradeGroups || [])
          .map((group: any) => group.id)
          .filter(Boolean);

        let studentRows: any[] = [];

        if (groupIds.length > 0) {
          const {
            data,
            error: studentsError
          } = await ctx.supabaseAdmin
            .from("students")
            .select("id, full_name, parent_phone")
            .in("group_id", groupIds)
            .eq("is_active", true);

          if (studentsError) {
            throw studentsError;
          }

          studentRows = data || [];
        }

        const uniqueParentStudents: any[] = [];
        const seenParentPhones = new Set<string>();

        for (const student of studentRows) {
          const normalizedPhone = phoneKey(student.parent_phone);
          if (!normalizedPhone || seenParentPhones.has(normalizedPhone)) {
            continue;
          }
          seenParentPhones.add(normalizedPhone);
          uniqueParentStudents.push(student);
        }

        const {
          data: alreadySentRows,
          error: alreadySentError
        } = await ctx.supabaseAdmin
          .from("notifications")
          .select("parent_phone")
          .eq(
            "homework_assignment_id",
            homeworkAssignmentId
          )
          .eq("status", "sent");

        if (alreadySentError) {
          console.error(
            "Existing homework notification check error:",
            alreadySentError
          );
        }

        const alreadySentParentPhones = new Set(
          (alreadySentRows || [])
            .map((row: any) => phoneKey(row.parent_phone))
            .filter(Boolean)
        );

        const deliveryContext =
          await prepareDeliveryContext(
            ctx,
            uniqueParentStudents
          );

        const fileCount = Array.isArray(
          assignment.homework_files
        )
          ? assignment.homework_files.length
          : 0;

        let sent = 0;
        let failed = 0;
        let withoutSubscription = 0;
        let skippedAlreadySent = 0;

        for (const student of uniqueParentStudents) {
          if (alreadySentParentPhones.has(phoneKey(student.parent_phone))) {
            skippedAlreadySent += 1;
            continue;
          }

          const title =
            `واجب جديد — ${student.full_name}`;

          const message =
            `${assignment.title || "واجب"} • ` +
            `${assignment.homework_date || ""}` +
            (fileCount
              ? ` • ${fileCount} مرفق`
              : "");

          const result = await deliverOne(
            ctx,
            deliveryContext,
            student,
            title,
            message,
            {
              homework_assignment_id:
                homeworkAssignmentId
            }
          );

          sent += result.sent;
          failed += result.failed;
          withoutSubscription +=
            result.withoutSubscription;
        }

        return Response.json({
          ok: failed === 0,
          homework_assignment_id:
            homeworkAssignmentId,
          grade_key: assignment.grade_key,
          students: studentRows.length,
          parents: uniqueParentStudents.length,
          sent,
          failed,
          without_subscription:
            withoutSubscription,
          skipped_already_sent:
            skippedAlreadySent
        });

      } catch (error) {
        console.error(
          "send-parent-push error:",
          error
        );

        return Response.json(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Unknown error"
          },
          { status: 500 }
        );
      }
    }
  )
};
