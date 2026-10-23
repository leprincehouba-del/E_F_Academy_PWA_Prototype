import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@1";
import webpush from "npm:web-push@3.6.7";

// Service-only SQL claims lease one delivery per device. No shared notification status.
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const { data: { user }, error: authError } = await ctx.supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { data: caller, error: callerError } = await ctx.supabaseAdmin.from("user_profiles")
      .select("role,is_active").eq("id", user.id).maybeSingle();
    if (callerError) return Response.json({ error: "Profile unavailable" }, { status: 503 });
    if (caller?.role !== "owner" || caller.is_active !== true)
      return Response.json({ error: "Owner only" }, { status: 403 });
    const pub = Deno.env.get("VAPID_PUBLIC_KEY");
    const priv = Deno.env.get("VAPID_PRIVATE_KEY");
    const subject = Deno.env.get("SUPABASE_URL");
    if (!pub || !priv || !subject) return Response.json({ error: "VAPID not configured" }, { status: 503 });
    webpush.setVapidDetails(subject, pub, priv);
    try {
      const { error: prepareError } = await ctx.supabaseAdmin.rpc("prepare_milestone_push");
      if (prepareError) throw prepareError;
      const { data: jobs, error: claimError } = await ctx.supabaseAdmin.rpc("claim_milestone_push", { p_limit: 20 });
      if (claimError) throw claimError;
      let sent = 0, failed = 0;
      for (const job of jobs || []) {
        let result = "sent", errorCode = null;
        try {
          await webpush.sendNotification(job.subscription, JSON.stringify({
            title: job.title, body: job.body,
            tag: "milestone:" + job.student_id + ":" + job.milestone_points,
            notification_id: job.notification_id,
            url: "./?milestone=" + job.milestone_points + "&student_id=" + encodeURIComponent(job.student_id)
          }), { TTL: 86400, urgency: "high", timeout: 10000 });
        } catch (error) {
          const code = Number((error as { statusCode?: number })?.statusCode || 0);
          result = code === 404 || code === 410 ? "expired" : "retry";
          errorCode = String(code || "transport");
        }
        const { data: finished, error: finishError } = await ctx.supabaseAdmin.rpc("finish_milestone_push", {
          p_student_id: job.student_id, p_milestone: job.milestone_points,
          p_subscription: job.subscription_id, p_lease: job.lease_token,
          p_result: result, p_error: errorCode
        });
        if (result === "sent" && !finishError && finished) sent++;
        else failed++;
      }
      return Response.json({ ok: failed === 0, sent, failed });
    } catch {
      return Response.json({ ok: false, error: "Milestone queue unavailable" }, { status: 503 });
    }
  })
};
