import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@1";
import webpush from "npm:web-push@3.6.7";

// Owner-only batch dispatcher. Existing in-app notifications are never duplicated.
function phoneKey(value: unknown) {
  let p = String(value || "").replace(/\D/g, "");
  if (p.startsWith("0020")) p = p.slice(4);
  else if (p.startsWith("20") && p.length >= 12) p = p.slice(2);
  if (!p.startsWith("0") && p.length === 10) p = "0" + p;
  return p;
}
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const { data: { user }, error: authError } = await ctx.supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { data: caller } = await ctx.supabaseAdmin.from("user_profiles")
      .select("role,is_active").eq("id", user.id).maybeSingle();
    if (caller?.role !== "owner" || caller.is_active !== true)
      return Response.json({ error: "Owner only" }, { status: 403 });

    const pub = Deno.env.get("VAPID_PUBLIC_KEY");
    const priv = Deno.env.get("VAPID_PRIVATE_KEY");
    const subject = Deno.env.get("SUPABASE_URL");
    if (!pub || !priv || !subject) return Response.json({ error: "VAPID not configured" }, { status: 503 });
    webpush.setVapidDetails(subject, pub, priv);
    // Fetch only pending notifications; already-sent rewards must not starve the queue.
    const { data: pending, error: fetchError } = await ctx.supabaseAdmin
      .from("notifications")
      .select("id,student_id,title,body,status,parent_phone")
      .eq("channel", "in_app")
      .eq("status", "pending")
      .like("title", "🎉 إنجاز جديد! %")
      .order("created_at", { ascending: true }).limit(100);
    if (fetchError) throw fetchError;
    const { data: profiles, error: profileError } = await ctx.supabaseAdmin.from("user_profiles")
      .select("id,phone").eq("role", "parent").eq("is_active", true);
    if (profileError) throw profileError;
    const byPhone = new Map((profiles || []).filter(p => phoneKey(p.phone).length === 11).map(p => [phoneKey(p.phone), p.id]));
    let sent = 0, failed = 0, noSubscription = 0;
    for (const notification of pending || []) {
      const { data: reward, error: rewardError } = await ctx.supabaseAdmin
        .from("student_milestone_rewards")
        .select("student_id,milestone_points")
        .eq("notification_id", notification.id).maybeSingle();
      if (rewardError || !reward) { failed++; continue; }
      const parentId = byPhone.get(phoneKey(notification.parent_phone));
      if (!parentId) { noSubscription++; continue; }
      const { data: subscriptions, error: subError } = await ctx.supabaseAdmin
        .from("push_subscriptions").select("endpoint,subscription").eq("user_id", parentId);
      if (subError) { failed++; continue; }
      if (!subscriptions?.length) { noSubscription++; continue; }
      // Claim before dispatch: a retry cannot send another celebration for the same award.
      const { data: claimed, error: claimError } = await ctx.supabaseAdmin
        .from("notifications").update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", notification.id).eq("status", "pending").select("id");
      if (claimError || !claimed?.length) continue;
      let delivered = false;
      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(sub.subscription, JSON.stringify({
            title: notification.title, body: notification.body, url: "./?milestone=" + reward.milestone_points + "&student_id=" + encodeURIComponent(reward.student_id)
          }), { TTL: 3600, urgency: "high" });
          delivered = true;
        } catch (error) {
          console.error("Milestone push failed", error);
          const code = Number((error as { statusCode?: number })?.statusCode || 0);
          if (code === 404 || code === 410)
            await ctx.supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
      if (delivered) sent++;
      else {
        failed++;
        await ctx.supabaseAdmin.from("notifications").update({ status: "failed" }).eq("id", notification.id);
      }
    }
    return Response.json({ ok: failed === 0, sent, failed, no_subscription: noSubscription });
  })
};
