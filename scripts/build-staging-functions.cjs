// Staging adapter: secrets remain in Vault and are never embedded in source.
const fs=require('node:fs');
const project=process.env.STAGING_PROJECT_REF;
if(!project||project==='bmnrltyodljgvrcssjhd'||!/^[a-z]{20}$/.test(project))throw Error('Independent staging project ref required');
const source=fs.readFileSync('supabase/functions/send-milestone-push/index.ts','utf8');
const adapted=source.replace('    const pub = Deno.env.get("VAPID_PUBLIC_KEY");\n    const priv = Deno.env.get("VAPID_PRIVATE_KEY");',`    const {data: cfg, error: configError} = await ctx.supabaseAdmin.rpc("staging_milestone_config");
    if(configError || !cfg) return Response.json({error:"Staging configuration unavailable"},{status:503});
    const pub = cfg.vapidPublic;
    const priv = cfg.vapidPrivate;`);
const queueBody=source.slice(source.indexOf('    webpush.setVapidDetails'),source.lastIndexOf('\n  })'));
const scheduled=`import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import webpush from "npm:web-push@3.6.7";
Deno.serve(async(req)=>{
 if(Deno.env.get("SUPABASE_URL")!=="https://${project}.supabase.co")return new Response("Wrong environment",{status:500});
 if(req.method!=="POST")return new Response("Method not allowed",{status:405});
 const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
 const {data:cfg,error}=await admin.rpc("staging_milestone_config");
 if(error||!cfg)return new Response("Unavailable",{status:503});
 if(!req.headers.get("x-milestone-scheduler")||req.headers.get("x-milestone-scheduler")!==cfg.schedulerToken)return new Response("Forbidden",{status:403});
 const ctx={supabaseAdmin:admin},pub=cfg.vapidPublic,priv=cfg.vapidPrivate,subject=Deno.env.get("SUPABASE_URL")!;
${queueBody.replace('p_limit: 20','p_limit: 10')}
});`;
fs.mkdirSync('staging-functions',{recursive:true});fs.writeFileSync('staging-functions/owner.ts',adapted);fs.writeFileSync('staging-functions/scheduled.ts',scheduled);
console.log('Generated Vault-backed staging adapters, without private keys in source.');
