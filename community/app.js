(() => {
  const config = window.CXCHANGER_COMMUNITY_CONFIG || {};
  const apiBase = (config.apiBase || "").replace(//$/, "");
  const MAX_MODEL_BYTES = 25 * 1024 * 1024;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MODEL_EXTENSIONS = new Set(["stl", "step", "stp"]);
  const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const form = document.querySelector("#upload-form");
  const submitButton = document.querySelector("#submit-button");
  const formMessage = document.querySelector("#form-message");
  const gallery = document.querySelector("#model-grid");
  const galleryStatus = document.querySelector("#gallery-status");
  const sortOrder = document.querySelector("#sort-order");
  const favoritesOnlyButton = document.querySelector("#favorites-only");
  const modelInput = document.querySelector("#model-file");
  const imageInput = document.querySelector("#image-file");
  let turnstileWidget = null;
  let favoritesOnly = false;
  let models = [];

  function readSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
    catch { return new Set(); }
  }
  function writeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(Array.from(value))); } catch {}
  }
  const votedIds = readSet("cxchanger-community-votes");
  const favorites = readSet("cxchanger-community-favorites");
  let voterId = localStorage.getItem("cxchanger-community-voter");
  if (!voterId) {
    voterId = crypto.randomUUID();
    try { localStorage.setItem("cxchanger-community-voter", voterId); } catch {}
  }

  function showMessage(message, kind) {
    formMessage.textContent = message;
    formMessage.className = "notice notice-" + (kind || "info");
    formMessage.hidden = false;
    formMessage.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }
  function api(path) { return apiBase + path; }
  async function requestJson(url, options) {
    const response = await fetch(url, options || {});
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok) throw new Error(result.error || "请求失败 (" + response.status + ")");
    return result;
  }
  function fileExtension(name) { return String(name).split(".").pop().toLowerCase(); }
  function validateFiles(model, image) {
    if (!model) throw new Error("请先选择一个 STL、STEP 或 STP 模型文件。");
    if (!MODEL_EXTENSIONS.has(fileExtension(model.name))) throw new Error("模型文件只接受 .STL、.STEP 或 .STP。");
    if (model.size > MAX_MODEL_BYTES) throw new Error("模型文件不能超过 25 MB。");
    if (image && image.size) {
      if (!IMAGE_TYPES.has(image.type)) throw new Error("图片只接受 JPG、PNG 或 WebP 格式。");
      if (image.size > MAX_IMAGE_BYTES) throw new Error("图片不能超过 5 MB。");
    }
  }
  function uploadFile(url, file, onProgress) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
      };
      xhr.onload = function () {
        let result = {};
        try { result = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(result);
        else reject(new Error(result.error || "文件上传失败 (" + xhr.status + ")"));
      };
      xhr.onerror = function () { reject(new Error("网络连接中断，请重试。")); };
      xhr.send(file);
    });
  }
  function setServiceState() {
    const notice = document.querySelector("#setup-notice");
    const ready = Boolean(apiBase && config.turnstileSiteKey);
    if (!ready) {
      notice.hidden = false;
      submitButton.disabled = true;
      galleryStatus.textContent = "上传和作品列表将在云存储完成配置后开放。";
      return;
    }
    if (window.turnstile) {
      turnstileWidget = window.turnstile.render("#turnstile-box", {
        sitekey: config.turnstileSiteKey,
        theme: "light",
        callback: function () { submitButton.disabled = false; },
        "expired-callback": function () { submitButton.disabled = true; },
        "error-callback": function () { submitButton.disabled = true; }
      });
    } else {
      notice.hidden = false;
      notice.textContent = "反垃圾验证暂时无法加载，请检查网络后刷新页面。";
      submitButton.disabled = true;
    }
  }
  function fileLabel(input, fallback) {
    const name = input.files && input.files[0] ? input.files[0].name : fallback;
    document.querySelector(input === modelInput ? "#model-file-name" : "#image-file-name").textContent = name;
  }
  modelInput.addEventListener("change", function () { fileLabel(modelInput, "还没有选择文件"); });
  imageInput.addEventListener("change", function () { fileLabel(imageInput, "还没有选择图片"); });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!apiBase || !config.turnstileSiteKey) { showMessage("上传服务还没有完成云端配置。", "error"); return; }
    const data = new FormData(form);
    const model = data.get("model");
    const image = data.get("image");
    try {
      validateFiles(model, image);
      const token = window.turnstile && window.turnstile.getResponse(turnstileWidget);
      if (!token) throw new Error("请先完成反垃圾验证。");
      submitButton.disabled = true;
      formMessage.hidden = false;
      formMessage.className = "notice notice-info";
      formMessage.textContent = "正在准备上传…";
      const metadata = {
        title: String(data.get("title")).trim(),
        author: String(data.get("author")).trim(),
        description: String(data.get("description") || "").trim(),
        modelName: model.name,
        modelSize: model.size,
        imageName: image && image.size ? image.name : "",
        imageSize: image && image.size ? image.size : 0,
        imageType: image && image.size ? image.type : "",
        turnstileToken: token
      };
      const initialized = await requestJson(api("/uploads"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata)
      });
      if (image && image.size) {
        formMessage.textContent = "正在上传作品图片…";
        await uploadFile(api("/uploads/" + initialized.id + "/image"), image, function (percent) {
          formMessage.textContent = "正在上传作品图片：" + percent + "%";
        });
      }
      formMessage.textContent = "正在上传原始模型文件…";
      await uploadFile(api("/uploads/" + initialized.id + "/model"), model, function (percent) {
        formMessage.textContent = "正在上传原始模型文件：" + percent + "%";
      });
      form.reset();
      fileLabel(modelInput, "还没有选择文件");
      fileLabel(imageInput, "还没有选择图片");
      if (window.turnstile) window.turnstile.reset(turnstileWidget);
      showMessage("提交成功！作品已进入审核队列，通过后会展示在作品广场。", "success");
    } catch (error) {
      showMessage(error.message || "上传失败，请稍后重试。", "error");
      if (window.turnstile && turnstileWidget !== null) window.turnstile.reset(turnstileWidget);
    } finally {
      submitButton.disabled = !(window.turnstile && window.turnstile.getResponse(turnstileWidget));
    }
  });

  function relativeDate(date) {
    const time = new Date(date).getTime();
    if (!Number.isFinite(time)) return "刚刚发布";
    const days = Math.max(0, Math.floor((Date.now() - time) / 86400000));
    if (days === 0) return "今天发布";
    if (days === 1) return "1 天前";
    return days + " 天前";
  }
  function renderModels() {
    let visible = models.slice();
    if (favoritesOnly) visible = visible.filter(function (model) { return favorites.has(model.id); });
    if (sortOrder.value === "new") visible.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    else visible.sort(function (a, b) { return b.votes - a.votes || new Date(b.createdAt) - new Date(a.createdAt); });
    if (!visible.length) {
      gallery.innerHTML = '<div class="model-empty">' + (favoritesOnly ? "还没有收藏作品。点击作品卡片上的 ♡，把喜欢的设计留起来。" : "暂时还没有公开作品。通过审核后的模型会显示在这里。") + "</div>";
      return;
    }
    gallery.innerHTML = visible.map(function (model) {
      const extension = fileExtension(model.modelName || "model.stl").toUpperCase();
      const image = model.hasImage ? '<img src="' + escapeHtml(api("/files/" + model.id + "/image")) + '" alt="' + escapeHtml(model.title) + ' 作品图片" loading="lazy" />' : '<span aria-hidden="true">' + escapeHtml(extension) + "</span>";
      const voted = votedIds.has(model.id);
      const saved = favorites.has(model.id);
      return '<article class="model-card" data-id="' + escapeHtml(model.id) + '"><div class="model-cover">' + image + '</div><div class="model-body"><div class="model-topline"><span class="file-badge">' + escapeHtml(extension) + ' MODEL</span><span class="model-date">' + escapeHtml(relativeDate(model.createdAt)) + '</span></div><h3>' + escapeHtml(model.title) + '</h3><p class="model-author">作者：' + escapeHtml(model.author) + '</p><p class="model-description">' + escapeHtml(model.description || "作者没有填写说明。") + '</p><div class="model-actions"><button class="model-action vote-button ' + (voted ? "voted" : "") + '" type="button" data-action="vote" ' + (voted ? "disabled" : "") + '>↑ 投票 · <span>' + (Number(model.votes) || 0) + '</span></button><a class="model-action" href="' + escapeHtml(api("/files/" + model.id + "/model")) + '">下载 ' + escapeHtml(extension) + '</a><button class="model-action favorite ' + (saved ? "saved" : "") + '" type="button" data-action="favorite" aria-label="' + (saved ? "取消收藏" : "收藏作品") + '" aria-pressed="' + saved + '">' + (saved ? "♥ 已收藏" : "♡ 收藏") + '</button></div></div></article>';
    }).join("");
  }
  gallery.addEventListener("click", async function (event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const card = button.closest(".model-card");
    const model = models.find(function (item) { return item.id === (card && card.dataset.id); });
    if (!model) return;
    if (button.dataset.action === "favorite") {
      if (favorites.has(model.id)) favorites.delete(model.id); else favorites.add(model.id);
      writeSet("cxchanger-community-favorites", favorites);
      renderModels();
      return;
    }
    button.disabled = true;
    try {
      const result = await requestJson(api("/models/" + model.id + "/vote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voterId: voterId })
      });
      model.votes = result.votes;
      votedIds.add(model.id);
      writeSet("cxchanger-community-votes", votedIds);
      renderModels();
    } catch (error) {
      button.disabled = false;
      galleryStatus.textContent = error.message || "投票失败，请重试。";
    }
  });
  async function loadModels() {
    if (!apiBase) { galleryStatus.textContent = "云存储配置完成后，这里会展示审核通过的玩家作品。"; return; }
    galleryStatus.textContent = "正在加载作品…";
    try {
      const result = await requestJson(api("/models?sort=" + encodeURIComponent(sortOrder.value)));
      models = result.models || [];
      galleryStatus.textContent = models.length ? "共 " + models.length + " 个公开作品" : "作品区已准备好，期待第一个玩家作品。";
      renderModels();
    } catch (error) { galleryStatus.textContent = error.message || "作品列表暂时无法加载。"; }
  }
  sortOrder.addEventListener("change", loadModels);
  favoritesOnlyButton.addEventListener("click", function () {
    favoritesOnly = !favoritesOnly;
    favoritesOnlyButton.setAttribute("aria-pressed", String(favoritesOnly));
    renderModels();
  });
  ["discussion-link", "hero-discussion-link", "bottom-discussion-link"].forEach(function (id) {
    document.getElementById(id).href = config.discussionUrl || "https://github.com/ers-ye/CxChanger-fork/discussions";
  });
  setServiceState();
  loadModels();
})();
