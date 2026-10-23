import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import webpush from "npm:web-push@3.6.7";
Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({error:"Method not allowed"},{status:405});
  const subject = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!subject || !key) return Response.json({error:"Unavailable"},{status:503});
  const admin = createClient(subject, key, {auth:{persistSession:false}});
  const {data:token,error:tokenError} = await admin.rpc("milestone_scheduler_token");
  if (tokenError || !token) return Response.json({error:"Unavailable"},{status:503});
  if (!req.headers.get("x-milestone-scheduler") || req.headers.get("x-milestone-scheduler") !== token)
    return Response.json({error:"Forbidden"},{status:403});
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return Response.json({error:"VAPID not configured"},{status:503});
  webpush.setVapidDetails(subject, pub, priv);
  let body;
  try { body = await req.json(); } catch { return Response.json({error:"Invalid JSON"},{status:400}); }
  if (body.dry_run === true) return Response.json({ok:true,vapid_matches:!body.expected_public_key || pub===body.expected_public_key});
  const ctx = {supabaseAdmin:admin};
    try {
      const { error: prepareError } = await ctx.supabaseAdmin.rpc("prepare_milestone_push");
      if (prepareError) throw prepareError;
      const { data: jobs, error: claimError } = await ctx.supabaseAdmin.rpc("claim_milestone_push", { p_limit: 10 });
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
});
