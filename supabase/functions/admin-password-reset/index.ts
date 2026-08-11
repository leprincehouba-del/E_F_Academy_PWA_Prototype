import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@1";

export default {
  fetch: withSupabase(
    { auth: "user" },

    async (req, ctx) => {
      try {
        const {
          data: { user },
          error: userError,
        } = await ctx.supabase.auth.getUser();

        if (userError || !user) {
          return Response.json(
            { ok: false, error: "Unauthorized" },
            { status: 401 },
          );
        }

        // السماح للمالك فقط
        const {
          data: callerProfile,
          error: callerError,
        } = await ctx.supabaseAdmin
          .from("user_profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        if (callerError) throw callerError;

        if (!callerProfile || callerProfile.role !== "owner") {
          return Response.json(
            { ok: false, error: "Owner only" },
            { status: 403 },
          );
        }

        let body: {
          phone?: string;
          new_password?: string;
        } = {};

        try {
          body = await req.json();
        } catch {
          body = {};
        }

        let phone = String(body.phone || "")
          .trim()
          .replace(/\D/g, "");

        const newPassword = String(body.new_password || "");

        // تحويل 20xxxxxxxxxx إلى 0xxxxxxxxxx
        if (phone.startsWith("20") && phone.length === 12) {
          phone = "0" + phone.slice(2);
        }

        if (!/^01[0125]\d{8}$/.test(phone)) {
          return Response.json(
            { ok: false, error: "Invalid phone" },
            { status: 400 },
          );
        }

        if (newPassword.length < 6) {
          return Response.json(
            { ok: false, error: "Password too short" },
            { status: 400 },
          );
        }

        const emailCandidates = [
          `${phone}@efacademy.local`,
          `${phone}@example.com`,
        ].map((email) => email.toLowerCase());

        let targetUser = null;
        const perPage = 1000;

        for (let page = 1; page <= 20; page++) {
          const {
            data: usersData,
            error: usersError,
          } = await ctx.supabaseAdmin.auth.admin.listUsers({
            page,
            perPage,
          });

          if (usersError) throw usersError;

          const users = usersData.users || [];

          targetUser = users.find((authUser) => {
            let metadataPhone = String(
              authUser.user_metadata?.phone || "",
            ).replace(/\D/g, "");

            if (
              metadataPhone.startsWith("20") &&
              metadataPhone.length === 12
            ) {
              metadataPhone = "0" + metadataPhone.slice(2);
            }

            const userEmail = String(
              authUser.email || "",
            ).toLowerCase();

            return (
              metadataPhone === phone ||
              emailCandidates.includes(userEmail)
            );
          });

          if (targetUser || users.length < perPage) {
            break;
          }
        }

        if (!targetUser) {
          return Response.json(
            { ok: false, error: "User not found" },
            { status: 404 },
          );
        }

        const { error: updateError } =
          await ctx.supabaseAdmin.auth.admin.updateUserById(
            targetUser.id,
            {
              password: newPassword,
            },
          );

        if (updateError) throw updateError;

        return Response.json({
          ok: true,
        });
      } catch (error) {
        console.error("admin-password-reset error:", error);

        return Response.json(
          { ok: false, error: "Password reset failed" },
          { status: 500 },
        );
      }
    },
  ),
};