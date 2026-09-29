(() => {
  const config = window.CXCHANGER_COMMUNITY_CONFIG || {};
  const configuredBase = config.apiBase || "";
  const apiBase = configuredBase.endsWith("/") ? configuredBase.slice(0, -1) : configuredBase;
  const tokenInput = document.querySelector("#admin-token");
  const message = document.querySelector("#admin-message");
  const list = document.querySelector("#pending-list");
  let adminToken = "";
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }
  async function api(path, options) {
    const opts = options || {};
    const response = await fetch(apiBase + path, {
      ...opts,
      headers: Object.assign({}, opts.headers || {}, { Authorization: "Bearer " + adminToken })
    });
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok) throw new Error(result.error || "请求失败 (" + response.status + ")");
    return result;
  }
  async function downloadModel(id, filename) {
    try {
      const response = await fetch(apiBase + "/admin/files/" + id + "/model", { headers: { Authorization: "Bearer " + adminToken } });
      if (!response.ok) throw new Error("模型下载失败。");
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename || "model.stl";
      link.click();
      setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
    } catch (error) { message.textContent = error.message; }
  }
  async function moderate(id, action, button) {
    const verb = action === "approve" ? "公开展示" : "拒绝并永久删除";
    if (!window.confirm("确定" + verb + "这个作品吗？")) return;
    button.disabled = true;
    try {
      await api("/admin/models/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: action }) });
      message.textContent = action === "approve" ? "作品已公开。" : "作品和文件已删除。";
      await loadPending();
    } catch (error) { button.disabled = false; message.textContent = error.message || "操作失败。"; }
  }
  async function loadPending() {
    adminToken = tokenInput.value.trim();
    if (!apiBase || !adminToken) { message.textContent = "请先配置上传接口并输入管理员密钥。"; return; }
    message.textContent = "正在加载审核队列…";
    list.replaceChildren();
    try {
      const result = await api("/admin/pending");
      message.textContent = result.items.length ? "待审核：" + result.items.length + " 个作品" : "当前没有待审核作品。";
      for (const item of result.items) {
        const card = document.createElement("article");
        card.className = "pending-card";
        card.innerHTML = '<h2>' + escapeHtml(item.title) + '</h2><p class="pending-meta">作者：' + escapeHtml(item.author) + ' · ' + escapeHtml(item.modelName) + ' · ' + (item.modelSize / 1048576).toFixed(2) + ' MB · ' + escapeHtml(item.createdAt) + '</p><p class="pending-description">' + escapeHtml(item.description || "没有填写说明") + '</p><div class="pending-media"></div><div class="pending-actions"><button class="admin-action" type="button" data-action="download">下载模型</button><button class="admin-action approve" type="button" data-action="approve">通过并公开</button><button class="admin-action remove" type="button" data-action="reject">拒绝并删除文件</button></div>';
        card.querySelector('[data-action="download"]').addEventListener("click", function () { downloadModel(item.id, item.modelName); });
        if (item.hasImage) {
          const imageResponse = await fetch(apiBase + "/admin/files/" + item.id + "/image", { headers: { Authorization: "Bearer " + adminToken } });
          if (imageResponse.ok) {
            const image = document.createElement("img");
            image.className = "pending-preview";
            image.alt = item.title + " 预览";
            image.src = URL.createObjectURL(await imageResponse.blob());
            card.querySelector(".pending-media").append(image);
          }
        }
        card.querySelectorAll("button[data-action]").forEach(function (button) {
          if (button.dataset.action !== "download") button.addEventListener("click", function () { moderate(item.id, button.dataset.action, button); });
        });
        list.append(card);
      }
    } catch (error) { message.textContent = error.message || "读取审核队列失败。"; }
  }
  document.querySelector("#load-pending").addEventListener("click", loadPending);
  if (!apiBase) message.textContent = "上传接口尚未配置；请先完成部署说明中的 Cloudflare 设置。";
})();
