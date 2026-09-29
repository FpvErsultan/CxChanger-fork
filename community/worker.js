const MODEL_LIMIT = 25 * 1024 * 1024;
const IMAGE_LIMIT = 5 * 1024 * 1024;
const MODEL_EXTENSIONS = new Set(["stl", "step", "stp"]);
const IMAGE_TYPES = { "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"] };

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function origins(env) { return String(env.ALLOWED_ORIGIN || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); }
function cors(request, env) {
  const origin = request.headers.get("Origin");
  const headers = new Headers({ "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400", "Vary": "Origin" });
  if (origin && origins(env).includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
function json(request, env, data, status) {
  const headers = cors(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { status: status || 200, headers: headers });
}
function requireOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !origins(env).includes(origin)) throw new ApiError(403, "请求来源未获授权。");
}
function text(value, max, label, required) {
  if (typeof value !== "string") throw new ApiError(400, label + "格式不正确。");
  const clean = value.trim();
  if (required && !clean) throw new ApiError(400, "请填写" + label + "。");
  if (clean.length > max) throw new ApiError(400, label + "不能超过 " + max + " 个字符。");
  return clean;
}
function isUuid(value) {
  if (typeof value !== "string" || value.length !== 36 || value[8] !== "-" || value[13] !== "-" || value[18] !== "-" || value[23] !== "-") return false;
  return /^[0-9a-f]+$/i.test(value.split("-").join(""));
}
function modelInfo(filename) {
  const clean = String(filename || "").trim();
  const extension = clean.split(".").pop().toLowerCase();
  if (!MODEL_EXTENSIONS.has(extension)) throw new ApiError(400, "模型文件只接受 STL、STEP 或 STP 格式。");
  return { name: clean, extension: extension };
}
function imageInfo(filename, mime) {
  const clean = String(filename || "").trim();
  const extension = clean.split(".").pop().toLowerCase();
  if (!IMAGE_TYPES[mime] || !IMAGE_TYPES[mime].includes(extension)) throw new ApiError(400, "图片格式需与 JPG、PNG 或 WebP 扩展名匹配。");
  return { name: clean, extension: extension };
}
async function verifyTurnstile(token, env) {
  if (!env.TURNSTILE_SECRET) throw new ApiError(503, "上传验证尚未配置，请联系社区管理员。");
  if (typeof token !== "string" || !token || token.length > 2048) throw new ApiError(400, "请完成反垃圾验证。");
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token })
  });
  if (!response.ok) throw new ApiError(502, "暂时无法验证，请稍后重试。");
  const result = await response.json();
  if (!result.success) throw new ApiError(400, "反垃圾验证已过期，请重新验证后提交。");
  if (env.TURNSTILE_HOSTNAME && result.hostname !== env.TURNSTILE_HOSTNAME) throw new ApiError(400, "反垃圾验证来源不匹配，请刷新页面后重试。");
}
async function initUpload(request, env) {
  requireOrigin(request, env);
  if (!env.DB || !env.MODELS) throw new ApiError(503, "上传服务尚未完成数据库和存储配置。");
  const input = await request.json();
  const title = text(input.title, 80, "作品名称", true);
  const author = text(input.author, 40, "作者昵称", true);
  const description = text(input.description || "", 1200, "作品说明", false);
  const model = modelInfo(input.modelName);
  const modelSize = Number(input.modelSize);
  if (!Number.isInteger(modelSize) || modelSize < 1 || modelSize > MODEL_LIMIT) throw new ApiError(400, "模型文件大小需大于 0 且不超过 25 MB。");
  const imageSize = Number(input.imageSize || 0);
  const hasImage = imageSize > 0;
  let image = { name: "", extension: "", mime: "" };
  if (hasImage) {
    if (!Number.isInteger(imageSize) || imageSize > IMAGE_LIMIT) throw new ApiError(400, "图片不能超过 5 MB。");
    image = imageInfo(input.imageName, input.imageType);
    image.mime = input.imageType;
  }
  await verifyTurnstile(input.turnstileToken, env);
  const id = crypto.randomUUID().toLowerCase();
  const modelKey = id + "/model." + model.extension;
  const imageKey = hasImage ? id + "/image." + image.extension : null;
  await env.DB.prepare("INSERT INTO models (id,title,author,description,model_name,model_key,model_size,image_name,image_key,image_size,image_type,image_expected,image_uploaded,model_uploaded,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'uploading')")
    .bind(id,title,author,description,model.name,modelKey,modelSize,image.name,imageKey,imageSize,image.mime,hasImage ? 1 : 0,hasImage ? 0 : 1,0).run();
  return json(request, env, { id: id });
}
async function uploadObject(request, env, id, kind) {
  requireOrigin(request, env);
  if (!isUuid(id)) throw new ApiError(404, "上传记录不存在。");
  const row = await env.DB.prepare("SELECT * FROM models WHERE id=? AND status='uploading'").bind(id).first();
  if (!row) throw new ApiError(404, "上传已过期或不存在，请重新提交。");
  let key, expected, contentType, limit;
  if (kind === "model") { key=row.model_key; expected=row.model_size; contentType="application/octet-stream"; limit=MODEL_LIMIT; }
  else {
    if (!row.image_expected) throw new ApiError(400, "这条上传没有图片文件。");
    key=row.image_key; expected=row.image_size; contentType=row.image_type; limit=IMAGE_LIMIT;
  }
  if (!request.body) throw new ApiError(400, "上传内容为空。");
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > 0 && declared !== expected) throw new ApiError(400, "文件大小与表單信息不匹配。");
  if (expected < 1 || expected > limit) throw new ApiError(400, "文件超出允许大小。");
  const object = await env.MODELS.put(key, request.body, { httpMetadata: { contentType: contentType }, customMetadata: { uploadId: id, kind: kind } });
  if (object.size !== expected) { await env.MODELS.delete(key); throw new ApiError(400, "上传文件大小不匹配，请重试。"); }
  if (kind === "model") await env.DB.prepare("UPDATE models SET model_uploaded=1 WHERE id=?").bind(id).run();
  else await env.DB.prepare("UPDATE models SET image_uploaded=1 WHERE id=?").bind(id).run();
  const current = await env.DB.prepare("SELECT model_uploaded,image_uploaded FROM models WHERE id=?").bind(id).first();
  const ready = Boolean(current && current.model_uploaded && current.image_uploaded);
  if (ready) await env.DB.prepare("UPDATE models SET status='pending' WHERE id=? AND status='uploading'").bind(id).run();
  return json(request, env, { uploaded: kind, readyForReview: ready });
}
async function listModels(request, env, url) {
  const ordering = url.searchParams.get("sort") === "new" ? "created_at DESC" : "votes DESC, created_at DESC";
  const result = await env.DB.prepare("SELECT id,title,author,description,model_name AS modelName,model_size AS modelSize,image_key AS imageKey,votes,created_at AS createdAt FROM models WHERE status='approved' ORDER BY " + ordering + " LIMIT 100").all();
  const models = (result.results || []).map(function (row) { const item=Object.assign({},row); delete item.imageKey; item.hasImage=Boolean(row.imageKey); return item; });
  return json(request, env, { models: models });
}
async function vote(request, env, id) {
  requireOrigin(request, env);
  if (!isUuid(id)) throw new ApiError(404, "作品不存在。");
  const input = await request.json();
  if (!isUuid(input.voterId)) throw new ApiError(400, "投票标识无效。");
  const exists = await env.DB.prepare("SELECT id FROM models WHERE id=? AND status='approved'").bind(id).first();
  if (!exists) throw new ApiError(404, "作品不存在或尚未公开。");
  const inserted = await env.DB.prepare("INSERT OR IGNORE INTO votes (model_id,voter_id) VALUES (?,?)").bind(id,input.voterId).run();
  if (inserted.meta && inserted.meta.changes) await env.DB.prepare("UPDATE models SET votes=votes+1 WHERE id=?").bind(id).run();
  const row = await env.DB.prepare("SELECT votes FROM models WHERE id=?").bind(id).first();
  return json(request, env, { votes: Number(row && row.votes || 0), accepted: Boolean(inserted.meta && inserted.meta.changes) });
}
function constantTimeEqual(candidate, expected) {
  if (!candidate || !expected || candidate.length !== expected.length) return false;
  let diff=0;
  for (let i=0;i<expected.length;i++) diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
function requireAdmin(request, env) {
  const header=request.headers.get("Authorization") || "";
  const candidate=header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!constantTimeEqual(candidate,env.ADMIN_TOKEN)) throw new ApiError(401,"管理员密钥无效。");
}
async function adminPending(request, env) {
  requireAdmin(request,env);
  const result=await env.DB.prepare("SELECT id,title,author,description,model_name AS modelName,model_size AS modelSize,image_key AS imageKey,created_at AS createdAt FROM models WHERE status='pending' ORDER BY created_at ASC LIMIT 100").all();
  const items=(result.results || []).map(function(row){const item=Object.assign({},row);delete item.imageKey;item.hasImage=Boolean(row.imageKey);return item;});
  return json(request,env,{items:items});
}
async function getObject(request,env,id,kind,admin) {
  if(!isUuid(id)) throw new ApiError(404,"文件不存在。");
  if(admin) requireAdmin(request,env);
  const query=admin ? "SELECT * FROM models WHERE id=?" : "SELECT * FROM models WHERE id=? AND status='approved'";
  const row=await env.DB.prepare(query).bind(id).first();
  if(!row) throw new ApiError(404,"文件不存在。");
  const key=kind==="model"?row.model_key:kind==="image"?row.image_key:null;
  if(!key) throw new ApiError(404,"文件不存在。");
  const object=await env.MODELS.get(key);
  if(!object) throw new ApiError(404,"文件不存在。");
  const headers=cors(request,env);
  object.writeHttpMetadata(headers);
  headers.set("X-Content-Type-Options","nosniff");
  headers.set("Cache-Control",admin?"private, no-store":"public, max-age=3600");
  if(kind==="model") {
    const ext=modelInfo(row.model_name).extension;
    headers.set("Content-Type","application/octet-stream");
    headers.set("Content-Disposition","attachment; filename=cxchanger-model."+ext);
  } else { headers.set("Content-Type",row.image_type || "application/octet-stream"); headers.set("Content-Disposition","inline"); }
  if(object.httpEtag) headers.set("ETag",object.httpEtag);
  return new Response(object.body,{headers:headers});
}
async function moderate(request,env,id) {
  requireOrigin(request,env); requireAdmin(request,env);
  if(!isUuid(id)) throw new ApiError(404,"作品不存在。");
  const row=await env.DB.prepare("SELECT * FROM models WHERE id=? AND status='pending'").bind(id).first();
  if(!row) throw new ApiError(404,"待审核作品不存在。");
  const input=await request.json();
  if(input.action==="approve") { await env.DB.prepare("UPDATE models SET status='approved' WHERE id=? AND status='pending'").bind(id).run(); return json(request,env,{status:"approved"}); }
  if(input.action==="reject") {
    await env.MODELS.delete([row.model_key,row.image_key].filter(Boolean));
    await env.DB.prepare("UPDATE models SET status='rejected',model_key=NULL,image_key=NULL WHERE id=?").bind(id).run();
    return json(request,env,{status:"rejected",deletedFiles:true});
  }
  throw new ApiError(400,"审核操作无效。");
}
async function cleanupExpiredUploads(env) {
  const result=await env.DB.prepare("SELECT id,model_key,image_key FROM models WHERE status='uploading' AND created_at < datetime('now','-1 day') LIMIT 100").all();
  for(const row of result.results || []) {
    await env.MODELS.delete([row.model_key,row.image_key].filter(Boolean));
    await env.DB.prepare("DELETE FROM models WHERE id=? AND status='uploading'").bind(row.id).run();
  }
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(request.method==="OPTIONS") { const headers=cors(request,env); return new Response(null,{status:headers.has("Access-Control-Allow-Origin")?204:403,headers:headers}); }
    try {
      const p=url.pathname.split("/").filter(Boolean);
      if(p[0]!=="api") throw new ApiError(404,"未找到接口。");
      if(request.method==="GET" && p.length===2 && p[1]==="models") return await listModels(request,env,url);
      if(request.method==="POST" && p.length===2 && p[1]==="uploads") return await initUpload(request,env);
      if(request.method==="PUT" && p.length===4 && p[1]==="uploads" && ["model","image"].includes(p[3])) return await uploadObject(request,env,p[2],p[3]);
      if(request.method==="POST" && p.length===4 && p[1]==="models" && p[3]==="vote") return await vote(request,env,p[2]);
      if(request.method==="GET" && p.length===3 && p[1]==="admin" && p[2]==="pending") return await adminPending(request,env);
      if(request.method==="GET" && p.length===5 && p[1]==="admin" && p[2]==="files" && ["model","image"].includes(p[4])) return await getObject(request,env,p[3],p[4],true);
      if(request.method==="POST" && p.length===4 && p[1]==="admin" && p[2]==="models") return await moderate(request,env,p[3]);
      if(request.method==="GET" && p.length===4 && p[1]==="files" && ["model","image"].includes(p[3])) return await getObject(request,env,p[2],p[3],false);
      throw new ApiError(404,"未找到接口。");
    } catch(error) {
      if(error instanceof ApiError) return json(request,env,{error:error.message},error.status);
      return json(request,env,{error:"服务器暂时无法处理请求，请稍后重试。"},500);
    }
  },
  async scheduled(_event,env) { await cleanupExpiredUploads(env); }
};
