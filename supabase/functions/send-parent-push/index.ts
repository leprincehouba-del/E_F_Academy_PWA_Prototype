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

function attendanceLabel(status: string) {
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

        const {
          data: callerProfile,
          error: callerError
        } = await ctx.supabaseAdmin
          .from("user_profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        if (callerError) {
          throw callerError;
        }

        if (
          !callerProfile ||
          !["owner", "manager"].includes(
            callerProfile.role
          )
        ) {
          return Response.json(
            {
              ok: false,
              error: "Not allowed"
            },
            { status: 403 }
          );
        }

        let requestBody: {
          session_id?: string;
        } = {};

        try {
          requestBody = await req.json();
        } catch {
          requestBody = {};
        }

        const sessionId =
          requestBody.session_id;

        if (!sessionId) {
          return Response.json(
            {
              ok: false,
              error: "session_id is required"
            },
            { status: 400 }
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
            points_change
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
              .map(row => row.student_id)
              .filter(Boolean)
          )
        ];

        const {
          data: studentRows,
          error: studentsError
        } = await ctx.supabaseAdmin
          .from("students")
          .select(
            "id, full_name, parent_phone"
          )
          .in("id", studentIds);

        if (studentsError) {
          throw studentsError;
        }

        const studentById = new Map(
          (studentRows || []).map(student => [
            student.id,
            student
          ])
        );

        const {
          data: profiles,
          error: profilesError
        } = await ctx.supabaseAdmin
          .from("user_profiles")
          .select("id, phone")
          .not("phone", "is", null);

        if (profilesError) {
          throw profilesError;
        }

        const profileByPhone = new Map(
          (profiles || []).map(profile => [
            phoneKey(profile.phone),
            profile
          ])
        );

        const parentUserIds = [
          ...new Set(
            (studentRows || [])
              .map(student => {
                const profile =
                  profileByPhone.get(
                    phoneKey(
                      student.parent_phone
                    )
                  );

                return profile?.id;
              })
              .filter(Boolean)
          )
        ];

        let subscriptions: any[] = [];

        if (parentUserIds.length > 0) {
          const {
            data,
            error
          } = await ctx.supabaseAdmin
            .from("push_subscriptions")
            .select(
              "user_id, endpoint, subscription"
            )
            .in(
              "user_id",
              parentUserIds
            );

          if (error) {
            throw error;
          }

          subscriptions = data || [];
        }

        const subscriptionsByUser =
          new Map<string, any[]>();

        for (const subscription of subscriptions) {
          const list =
            subscriptionsByUser.get(
              subscription.user_id
            ) || [];

          list.push(subscription);

          subscriptionsByUser.set(
            subscription.user_id,
            list
          );
        }

        let sent = 0;
        let failed = 0;
        let withoutSubscription = 0;

        for (const attendance of attendanceRows) {
          const student =
            studentById.get(
              attendance.student_id
            );

          if (!student) {
            continue;
          }

          const parentPhone =
            student.parent_phone || "";

          const title =
            `حصة ${student.full_name}`;

          const points =
            Number(
              attendance.points_change || 0
            );

          const pointsText =
            points > 0
              ? `+${points}`
              : `${points}`;

          const message =
            `الحضور: ${attendanceLabel(
              attendance.attendance_status
            )} • ` +
            `${paymentLabel(
              attendance.attendance_status,
              attendance.payment_status,
              attendance.charge_amount
            )} • ` +
            `النقاط: ${pointsText}`;

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
              status: "pending"
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
            profileByPhone.get(
              phoneKey(parentPhone)
            );

          if (!parentProfile) {
            withoutSubscription += 1;
            continue;
          }

          const parentSubscriptions =
            subscriptionsByUser.get(
              parentProfile.id
            ) || [];

          if (
            parentSubscriptions.length === 0
          ) {
            withoutSubscription += 1;
            continue;
          }

          const payload =
            JSON.stringify({
              title,
              body: message,
              url: "./"
            });

          let studentSent = 0;
          let studentFailed = 0;

          for (
            const row of parentSubscriptions
          ) {
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
              studentSent += 1;

            } catch (error) {
              failed += 1;
              studentFailed += 1;

              console.error(
                "Push send error:",
                error
              );

              const statusCode =
                Number(
                  (error as any)?.statusCode ||
                  0
                );

              if (
                statusCode === 404 ||
                statusCode === 410
              ) {
                await ctx.supabaseAdmin
                  .from(
                    "push_subscriptions"
                  )
                  .delete()
                  .eq(
                    "endpoint",
                    row.endpoint
                  );
              }
            }
          }

          if (notification?.id) {
            if (studentSent > 0) {
              await ctx.supabaseAdmin
                .from("notifications")
                .update({
                  status: "sent",
                  sent_at:
                    new Date().toISOString()
                })
                .eq(
                  "id",
                  notification.id
                );

            } else if (
              studentFailed > 0
            ) {
              await ctx.supabaseAdmin
                .from("notifications")
                .update({
                  status: "failed"
                })
                .eq(
                  "id",
                  notification.id
                );
            }
          }
        }

        return Response.json({
          ok: failed === 0,
          session_id: sessionId,
          students:
            attendanceRows.length,
          sent,
          failed,
          without_subscription:
            withoutSubscription
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