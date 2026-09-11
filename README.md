# CF-GitHub-Proxy
#### 2025.5.25修改，现已支持github api加速！🎉🎉🎉
## 桌面端预览
![desktop](src/desktop.png)
## 移动端预览
![mobile](src/mobile.png)
## 简介
github release、archive以及项目文件的加速项目，支持clone，github api，Cloudflare Workers 版本

## 使用

在原始 GitHub / GitHub API / gist 链接**前面**直接加上本代理域名即可，例如：

```
https://你的代理域名/https://github.com/owner/repo/releases/download/v0.1.0/example.zip
```

也可以直接访问代理首页，在输入框中粘贴链接提交（首页会对链接格式做前端校验）。

***大量使用建议自行部署；以下为第三方演示域名，仅适合轻量使用：`https://ghfile.geekertao.top/`、`https://gh.geekertao.top/`、`https://github.dpik.top/`、`https://gh.felicity.ac.cn/`。***

访问私有仓库可以通过（需在代码 `Config.githubToken` 中配置有权限的 Token）：

```
git clone https://user:TOKEN@你的代理域名/https://github.com/xxxx/xxxx
```

（参考 [gh-proxy issue #71](https://github.com/hunshcn/gh-proxy/issues/71)）

### 支持的链接格式

以下均为合法输入（示例中的文件/目录不保证存在），链接**带不带 `https://` 协议头都支持**：

| 类型 | 原始链接示例 | 代理行为 |
| --- | --- | --- |
| 分支源码（archive） | `https://github.com/owner/repo/archive/refs/heads/master.zip` | 转发到上游；GitHub 302 到 codeload 后由代理内部跟随跳转，最终返回 `200 + application/zip` |
| release 源码 | `https://github.com/owner/repo/archive/v0.1.0.tar.gz` | 转发到上游 |
| release 文件 | `https://github.com/owner/repo/releases/download/v0.1.0/example.zip` | 转发到上游 |
| 分支 / commit 文件（blob） | `https://github.com/owner/repo/blob/master/filename` | `Config.jsdelivr` 开启时 302 到 jsDelivr，否则按 raw 转发 |
| raw 文件 | `https://raw.githubusercontent.com/owner/repo/master/filename` | 转发到上游 |
| gist | `https://gist.githubusercontent.com/user/id/raw/file` | 转发到上游 |
| GitHub API | `https://api.github.com/repos/owner/repo` | 转发到上游 |
| tags 页面 | `https://github.com/owner/repo/tags` | 转发到上游 |
| 文件夹打包下载 | `https://github.com/C018/CF-GitHub-Proxy/tree/main/src` | 在 Worker 内打包为 zip 返回（见下节） |

> 其它路径（例如 `/favicon.ico`、`/robots.txt` 等不存在的资源）不会转发，直接返回自建 HTML 提示页，详见「未匹配路径的处理」。

## 文件夹下载（新增）

无需 clone 整个仓库，直接下载仓库中某个子目录的压缩包：

```
https://你的代理域名/https://github.com/{owner}/{repo}/tree/{ref}/{子目录路径}
```

例如打包 `C018/CF-GitHub-Proxy` 仓库 `main` 分支下的 `src` 目录：

```
https://你的代理域名/https://github.com/C018/CF-GitHub-Proxy/tree/main/src
```

返回的 zip 文件名形如 `{repo}-{ref}-{子目录}.zip`（如 `CF-GitHub-Proxy-main-src.zip`）。

**工作方式**

- 通过 GitHub API 递归获取该子目录下的文件清单，并发抓取文件内容后，在 Worker 内存中打包为 zip 返回（`Content-Type: application/zip`、`Content-Disposition: attachment`）。
- zip 采用 **STORE 不压缩**方式，由代码自行实现 CRC32 与 zip 结构（本地文件头 + 中央目录 + EOCD，文件名 UTF-8），无需任何第三方依赖。
- 打包结果只包含该子目录内部的内容，不包含子目录本身的层级前缀（例如打包 `src`，zip 内是 `index.js`、`utils/a.txt`，而不是 `src/index.js`）。

**只写仓库地址（不带子目录）时**

```
https://你的代理域名/https://github.com/{owner}/{repo}/tree/{ref}
```

会 302 跳转到本代理的整仓库下载地址 `https://你的代理域名/https://github.com/{owner}/{repo}/archive/refs/heads/{ref}.zip`。

**保护性限制**

为防止 Worker 内存或上游配额被撑爆，单次打包设有限额（可在代码顶部 `ZIP_LIMITS` 中调整）：

| 限制项 | 默认值 |
| --- | --- |
| 单次打包文件数 | 60 个 |
| 单个文件体积 | 20 MB |
| 打包总体积 | 40 MB |
| 并发抓取数 | 8 |

- 超出上述任一限制时，返回自建 HTML 提示页（HTTP 200），并给出整仓库 archive 下载链接，**不会返回残缺的 zip**；
- GitHub API 配额耗尽（HTTP 403 / 429）时同样返回提示页，提示可配置 Token；
- 目录不存在、目录为空、目录为子模块（submodule）、文件数过多导致 API 返回结果被截断（`truncated`）时，均返回对应的提示页；
- zip 为 **STORE 不压缩**，因此压缩包体积约等于目录原始体积，且整体在 Worker 内存中组装；
- Cloudflare **免费版单次请求的子请求上限为 50**，而打包一个目录至少需要 1～2 次 API 查询加上每个文件 1 次抓取；若把 `maxFiles` 调到接近或超过 50，大目录可能因超出子请求上限而失败，建议按套餐上限调整（免费版建议 ≤ 45）。

### 配置项

所有配置都在两份 JS 文件顶部（`workers.js` 与 `snippets.js` 内容完全一致）：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `PREFIX` | `'/'` | 代理路径前缀，一般保持默认 |
| `Config.jsdelivr` | `0`（关闭） | blob 分支文件是否 302 到 jsDelivr 镜像，`1` 为开启 |
| `Config.githubToken` | `''` | GitHub Token，用于提升 API 配额并支持私有仓库 |
| `whiteList` | `[]` | 路径白名单，仅放行路径中包含数组中任一字符串的请求；空数组表示不限制 |
| `ZIP_LIMITS` | 见上表 | 文件夹打包的文件数 / 单文件体积 / 总体积 / 并发上限 |
| `UA` | `'CF-GitHub-Proxy'` | 转发到上游时使用的 User-Agent |
| `HOME_HTML` | 内置页面 | 代理首页 HTML，favicon 已内联为 data URI，不依赖任何外部站点 |
| `PREFLIGHT_INIT` | — | CORS 预检（OPTIONS）响应配置 |

**关于 GitHub Token（可选，推荐）**

在代码顶部 `Config` 中填入 `githubToken` 即可：

```javascript
const Config = {
    // 分支文件使用 jsDelivr 镜像的开关，0 为关闭，默认关闭
    jsdelivr: 0,
    // GitHub Token（可选，默认空字符串）：
    //   1) 提升 GitHub API 配额：匿名 60 次/小时 → 携带 Token 5000 次/小时；
    //   2) 支持打包/代理私有仓库内容。
    githubToken: 'ghp_xxxxxxxxxxxxxxxxxxxx'
}
```

- 匿名调用 GitHub API 的配额为 **60 次/小时**（每次文件夹打包大约消耗 1～2 次），配额耗尽会返回提示页；
- 配置 Token 后配额提升到 **5000 次/小时**，同时可用于打包/代理私有仓库内容；
- 建议使用最小权限的 Token（如只读的 `public_repo` / `repo`），并注意不要将其提交到公开仓库。

## 未匹配路径的处理（新增）

对于**不属于** release / archive / blob / raw / gist / tags / api / tree 任何转发规则的路径，代理不转发到上游、也不返回 404，而是直接返回自建的 HTML 提示页（**HTTP 状态码 200**），页面中列出所有支持的链接格式示例。

这样处理后，即便上层 CDN 配置了「错误页 / 默认 404 页」规则，本代理的提示页也不会被替换成主站的默认 404 页面。

首页 `/`（含带 query 的 `/?xxx`）直接返回代码内置的 `HOME_HTML`，不请求任何外部站点；页面用到的 favicon 已内联为 data URI。因此**除首页与未匹配提示页外，`/favicon.ico`、`/robots.txt` 等未匹配路径同样返回该提示页（200），而不再由上游静态资源站提供**。

## 已知限制

- **GitHub 旧式 archive / release 源码链接**：`github.com/{owner}/{repo}/archive/{ref}.zip`、`archive/{tag}.tar.gz` 与 `releases/...` 均由本代理转发。GitHub 会将它们 302 到 `codeload.github.com`，本代理在服务端**自动跟随**该跳转并把文件内容回传给客户端，因此客户端收到的是本代理返回的 `HTTP 200 + application/zip`（实测行为），下载流量全程经过代理，不存在客户端直连 codeload 的情况。
- **GitHub API 配额**：匿名 60 次/小时，配额耗尽时文件夹打包与 API 代理都会返回提示页，建议配置 `Config.githubToken`。
- **免费版子请求上限**：Cloudflare 免费版单次请求最多 50 个子请求，限制了单次可打包的文件数（详见「保护性限制」）。
- **jsDelivr 开关只作用于 blob**：`Config.jsdelivr = 1` 时，只有 `github.com/{owner}/{repo}/blob/...` 会 302 到 jsDelivr；`raw.githubusercontent.com/...` 形式的链接始终原样转发，不受该开关影响。
- **tree 分支名含 `/`**：文件夹打包按「第一个 `/` 前为 ref、其余为子目录」解析，因此形如 `feature/foo` 的带斜杠分支名无法直接用于文件夹打包，可改用 release 或整仓库 archive 地址。
- **打包不压缩**：zip 采用 STORE 方式，体积约等于原始文件总大小，且需在 Worker 内存中组装，受 `ZIP_LIMITS` 限制。
- **不递归 submodule**：目录中的 git submodule 不会展开其内容。

## Workers 部署方法
### 部署 Cloudflare Worker：

   - 在 Cloudflare Worker 控制台中创建一个新的 Worker。
   - 将 [workers.js](./workers.js)  的内容粘贴到 Worker 编辑器中。

## Snippets 部署方法
### 部署 Snippets：

   - 需要检查是否开通了 Snippets 功能，订阅pro以上计划或灰度测试到才可以使用，使用以下代码在F12开发者控制台输入查看哪些已经开通了Snippets功能：

   ```javascript
   
   (async function main() {
    const zonesUrl = (page = 1) =>
        `https://dash.cloudflare.com/api/v4/zones?type=full,partial,secondary&per_page=100&page=${page}`;

    async function fetchJson(url) {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return res.json();
    }

    try {
        const results = [];
        let page = 1;

        while (true) {
            const zonesData = await fetchJson(zonesUrl(page));
            const zones = Array.isArray(zonesData.result) ? zonesData.result : [];
            if (zones.length === 0) break;

            for (const zone of zones) {
                const entitlementsUrl = `https://dash.cloudflare.com/api/v4/zones/${zone.id}/entitlements`;
                const entData = await fetchJson(entitlementsUrl);
                const entResults = Array.isArray(entData.result) ? entData.result : [];
                const rule = entResults.find(r => r.feature?.key === "rulesets.snippets_rule_max");
                const value = rule?.allocation?.value ?? 0;
                if (value > 0) {
                    results.push({
                        zone_id: zone.id,
                        zone_name: zone.name,
                        rulesets_snippets_rule_max: value
                    });
                }
            }

            const info = zonesData.result_info || {};
            if (!info.page || info.page >= (info.total_pages || info.page)) break;
            page++;
        }

        console.log(results);
    } catch (err) {
        console.error("请求失败:", err);
    }
})();

   ```
     
   
   来自<https://blog.cmliussss.com/p/BPSUB/#%F0%9F%A4%96-%E8%87%AA%E5%8A%A8%E6%A3%80%E6%B5%8B>
   - 在 Snippets 平台中创建一个新的 Snippet。
   - 将 [snippets.js](./snippets.js)  的内容粘贴到 Snippet 编辑器中。
   - 编辑页添加“片段规则”为“自定义筛选表达式“中的”“当传入请求匹配时...”，输入以下表达式：

   ```
   (http.host eq "yourghproxydomain.com")
   ```
注：请将 `yourghproxydomain.com` 替换为你实际使用的域名，且为有经过 Cloudflare 代理的域名，否则无法生效，添加优选CNAME也可。

- 保存并部署 Snippet。


## 项目文件说明

| 文件 | 说明 |
| --- | --- |
| `workers.js` | Cloudflare Workers 版，入口为 `addEventListener('fetch', ...)`，可直接粘贴到 Worker 编辑器 |
| `snippets.js` | Cloudflare Snippets 版，入口为 `export default { async fetch(request) {...} }`，主体逻辑与 `workers.js` 逐行一致 |
| `README.md` | 本说明文档 |
| `src/desktop.png`、`src/mobile.png` | 首页在桌面端 / 移动端的预览截图 |

- **代码来源**：基于 [gh-proxy](https://github.com/hunshcn/gh-proxy) 的 [`index.js`](https://github.com/hunshcn/gh-proxy/blob/master/index.js) 修改而来，并新增了文件夹打包下载与未匹配路径提示页。
- **首页代码**：HTML 部分参考 [CF-Workers-GitHub](https://github.com/cmliu/CF-Workers-GitHub/) 的 [`_worker.js`](https://github.com/cmliu/CF-Workers-GitHub/blob/main/_worker.js)，现已**完整内置于 `workers.js` / `snippets.js` 的 `HOME_HTML` 常量中**（favicon 为内联 data URI），不再从任何外部地址加载；修改首页直接编辑该常量即可。
- **两版同步**：`workers.js` 与 `snippets.js` 除文件头注释与入口写法外内容完全相同，改动请同步两处。

# 致谢
[gh-proxy](https://github.com/hunshcn/gh-proxy)、[jsproxy](https://github.com/EtherDream/jsproxy/)、[CF-Workers-GitHub](https://github.com/cmliu/CF-Workers-GitHub/)

# 赞助
<a href="https://afdian.com/a/Geekertao" target="_blank" rel="noopener noreferrer" style="flex-shrink: 0;">
      <img src="https://img.shields.io/badge/💵_爱发电-FF4D4D?style=flat-square&logo=usd&logoColor=white" alt="爱发电" style="max-height: 50px;">
    </a>


