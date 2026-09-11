# CF-Workers-GitHub-Proxy
#### 2025.5.25修改，现已支持github api加速！🎉🎉🎉
## 桌面端预览
![desktop](src/desktop.png)
## 移动端预览
![mobile](src/mobile.png)
## 简介
github release、archive以及项目文件的加速项目，支持clone，github api，Cloudflare Workers 版本

## 使用

直接在copy出来的url前加`https://ghfile.geekertao.top/`,`https://gh.geekertao.top/`,`https://github.dpik.top/`或`https://gh.felicity.ac.cn/`即可

也可以直接访问，在input输入

***大量使用建议自行部署，以上域名仅为演示使用，可以轻量使用。***

访问私有仓库可以通过

`git clone https://user:TOKEN@ghfile.geekertao.top/https://github.com/xxxx/xxxx`，`git clone https://user:TOKEN@github.dpik.top/https://github.com/xxxx/xxxx`，`git clone https://user:TOKEN@gh.felicity.ac.cn/https://github.com/xxxx/xxxx` [#71](https://github.com/hunshcn/gh-proxy/issues/71)

以下都是合法输入（仅示例，文件不存在）：

- 分支源码：https://github.com/hunshcn/project/archive/master.zip

- release源码：https://github.com/hunshcn/project/archive/v0.1.0.tar.gz

- release文件：https://github.com/hunshcn/project/releases/download/v0.1.0/example.zip

- 分支文件：https://github.com/hunshcn/project/blob/master/filename

- commit文件：https://github.com/hunshcn/project/blob/1111111111111111111111111111/filename

- gist：https://gist.githubusercontent.com/cielpy/351557e6e465c12986419ac5a4dd2568/raw/cmd.py

- api：https://api.github.com/repos/Geekertao/CF-Workers-GitHub-Proxy

- 文件夹打包下载：https://github.com/hunshcn/project/tree/master/src

## 文件夹下载（新增）

无需 clone 整个仓库，直接下载仓库中某个子目录的压缩包：

```
https://你的代理域名/https://github.com/{owner}/{repo}/tree/{ref}/{子目录路径}
```

例如打包 `hunshcn/project` 仓库 `master` 分支下的 `src` 目录：

```
https://你的代理域名/https://github.com/hunshcn/project/tree/master/src
```

返回的 zip 文件名形如 `{repo}-{ref}-{子目录}.zip`（如 `project-master-src.zip`）。

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
- GitHub API 配额耗尽（HTTP 403）时同样返回提示页，提示可配置 Token；
- 目录不存在、目录为空、目录为子模块（submodule）、文件数过多导致 API 返回结果被截断（`truncated`）时，均返回对应的提示页。

### 配置 GitHub Token（可选，推荐）

在代码顶部 `Config` 中填入 `githubToken` 即可：

```javascript
const Config = {
    // 分支文件使用 jsDelivr 镜像的开关，0 为关闭，默认关闭
    jsdelivr: 0,
    // GitHub Token（可选，默认空字符串），用于提升 GitHub API 配额
    githubToken: 'ghp_xxxxxxxxxxxxxxxxxxxx'
}
```

- 匿名调用 GitHub API 的配额为 **60 次/小时**（每次文件夹打包大约消耗 1～2 次），配额耗尽会返回提示页；
- 配置 Token 后配额提升到 **5000 次/小时**，同时可用于打包/代理私有仓库内容；
- 建议使用最小权限的 Token（如只读的 `public_repo` / `repo`），并注意不要将其提交到公开仓库。

## 未匹配路径的处理（新增）

对于**不属于** release / archive / blob / raw / gist / tags / api / tree 任何转发规则的路径，代理不再转发到上游、也不会返回 404，而是直接返回自建的 HTML 提示页（**HTTP 状态码 200**），页面中列出所有支持的链接格式示例。

这样处理后，即便上层 CDN 配置了「错误页 / 默认 404 页」规则，本代理的提示页也不会被替换成主站的默认 404 页面。首页 `/` 仍优先返回 `ASSET_URL` 页面，仅在拉取 `ASSET_URL` 失败时回落到本地提示页。

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

-  **`workers.js`**  ：基于 [gh-proxy](https://github.com/hunshcn/gh-proxy) 项目的 [`index.js`](https://github.com/hunshcn/gh-proxy/blob/master/index.js) 修改，已将 `ASSET_URL` 配置为我的 GitHub Pages 地址。
- **自定义配置**：如需修改 GitHub Pages 地址，请前往 [Geekertao.github.io](https://github.com/Geekertao/Geekertao.github.io/tree/main/gh-proxy) 仓库下载源码后编辑。
- **页面代码**：HTML 部分参考自 [CF-Workers-GitHub](https://github.com/cmliu/CF-Workers-GitHub/) 项目的 [`_worker.js`](https://github.com/cmliu/CF-Workers-GitHub/blob/main/_worker.js) 文件。

# 致谢
[gh-proxy](https://github.com/hunshcn/gh-proxy)、[jsproxy](https://github.com/EtherDream/jsproxy/)、[CF-Workers-GitHub](https://github.com/cmliu/CF-Workers-GitHub/)

# 赞助
<a href="https://afdian.com/a/Geekertao" target="_blank" rel="noopener noreferrer" style="flex-shrink: 0;">
      <img src="https://img.shields.io/badge/💵_爱发电-FF4D4D?style=flat-square&logo=usd&logoColor=white" alt="爱发电" style="max-height: 50px;">
    </a>


