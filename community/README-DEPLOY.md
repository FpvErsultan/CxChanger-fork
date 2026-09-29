# CxChanger 社区上传页部署说明

上传页接受原始 .stl、.step、.stp 文件，图片可选。GitHub Pages 负责页面；Cloudflare R2 保存文件，Workers 提供上传和审核接口，D1 保存作品、审核状态和投票。新投稿默认待审核，通过后才公开展示和下载。

## 部署前先了解

- 页面会公开展示审核通过的作品和图片；访客可以直接下载原始模型。上传者必须拥有公开分享这些文件的权利。
- Cloudflare 服务按计划提供月度额度，超出额度可能计费。请查看最新的 [R2 价格](https://developers.cloudflare.com/r2/pricing/) 和 [D1 价格](https://developers.cloudflare.com/d1/platform/pricing/)，并启用账单提醒。
- 单个模型限制为 25 MB，图片限制为 5 MB。接受 STL、STEP、STP、JPG、PNG 和 WebP。
- 投稿需完成 Turnstile 反垃圾验证。管理员密钥和 Turnstile Secret 只能保存在 Cloudflare Worker Secrets，不能提交到 GitHub。
- 收藏保存在访客自己的浏览器。投票按浏览器生成的 ID 对每个作品计一次；清除本地数据后可以再次投票，因此人气排序适合社区参考，不用于防作弊竞赛。

## 1. 创建 Cloudflare 资源

先在安装了 Node.js 的电脑上打开终端，并进入仓库中的 community 文件夹。以下命令由 Wrangler 创建 Cloudflare R2 和 D1 资源：

    npx wrangler login
    npx wrangler r2 bucket create cxchanger-community-files
    npx wrangler d1 create cxchanger-community

D1 命令会显示 database_id。把它填入本目录的 wrangler.toml，替换 REPLACE_WITH_D1_DATABASE_ID。ALLOWED_ORIGIN 与 TURNSTILE_HOSTNAME 保持为 https://ers-ye.github.io。

在 Cloudflare Turnstile 控制台为主机名 ers-ye.github.io 创建 Managed 小组件。记下 Site Key 和 Secret Key。Site Key 会公开写入页面配置；Secret Key 只设置为 Worker Secret。

## 2. 初始化数据库并部署 Worker

仍在 community 文件夹运行：

    npx wrangler d1 execute cxchanger-community --remote --file=./schema.sql
    npx wrangler secret put TURNSTILE_SECRET
    npx wrangler secret put ADMIN_TOKEN
    npx wrangler deploy

Wrangler 会交互式读取 TURNSTILE_SECRET 和 ADMIN_TOKEN。不要把这两个值写入代码文件或聊天。管理员密钥应使用随机生成的长字符串，并安全保存。

部署成功后，Wrangler 会显示 Worker URL，例如 https://cxchanger-community-api.<你的账户子域>.workers.dev。复制该地址并在末尾加上 /api。

## 3. 配置上传页并发布 GitHub Pages

编辑 config.js 中的 apiBase 和 turnstileSiteKey：

    apiBase: "https://cxchanger-community-api.<你的账户子域>.workers.dev/api",
    turnstileSiteKey: "粘贴 Cloudflare 提供的 Site Key",

这两个字段是公开配置，可以提交到 GitHub。不要把 Secret Key 或 ADMIN_TOKEN 写入 config.js。

完成后在仓库进入 Settings → Pages，把发布源设为 Deploy from a branch，选择 main 和 /(root) 并保存。页面地址为：

    https://ers-ye.github.io/CxChanger-fork/community/

根目录 README 的社区入口应链接到该地址。Worker 每天会清理创建超过 24 小时但未完成的临时上传记录及文件。

## 4. 审核作品

管理员打开以下地址，输入 ADMIN_TOKEN 后即可查看待审核列表：

    https://ers-ye.github.io/CxChanger-fork/community/admin.html

审核页可以预览图片、下载原始模型、通过并公开作品，或拒绝投稿并删除其模型和图片。管理密钥只保存在当前页面内存中；关闭或刷新页面后需要重新输入。

## 文件说明

- community/：公开社区页、作品广场、收藏和投票界面。
- community/admin.html 和 admin.js：管理员审核界面。
- community/worker.js：Cloudflare Worker API。
- community/schema.sql：D1 数据表结构。
- community/wrangler.toml：Worker、R2、D1 和每日清理配置。
