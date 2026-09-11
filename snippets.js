'use strict'

/**
 * CF-GitHub-Proxy — Cloudflare Snippets 版
 *
 * 功能：
 *  1. 代理 GitHub release / archive / blob / raw / gist / tags / api 资源（保留 jsDelivr 开关）；
 *  2. 新增「文件夹下载」：https://{代理域名}/https://github.com/{owner}/{repo}/tree/{ref}/{子目录}
 *     通过 GitHub API 递归获取文件清单 → 并发抓取文件内容 → 在 Worker 内存内打包为 zip（STORE 不压缩）返回；
 *  3. 首页返回本地内置 HTML（HOME_HTML，favicon 已内联为 data URI），不依赖任何外部静态资源；
 *  4. 未命中任何转发规则的路径直接返回自建 HTML 提示页（HTTP 200），避免被上层 CDN 的默认 404 页面接管。
 *
 * 零依赖单文件，可直接粘贴到 Cloudflare Snippets 编辑器运行。
 */

// 首页 favicon 已内联为 data URI，不再依赖任何外部站点的静态资源。
// 首页 HTML：本地内置，内容与原先的远程页面一致（已修正 CSS 语法瑕疵、更新提示文案与示例）。
const HOME_HTML = `<!DOCTYPE html>
		<html lang="zh-CN">
		<head>
			<title>GitHub 文件加速</title>
			<meta charset="UTF-8">
			<link rel="shortcut icon" type="image/png" href="data:image/png;base64,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">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<style>
				:root {
					--primary-color: #1a1e21;
					--primary-hover: #0d1117;
					--text-color: #f0f6fc;
					--bg-gradient: linear-gradient(135deg, #1a1e21 0%, #0d1117 100%);
					--shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
				}

				* {
					box-sizing: border-box;
					margin: 0;
					padding: 0;
				}

				body {
					font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
					min-height: 100vh;
					background: var(--bg-gradient);
					color: var(--text-color);
					display: flex;
					justify-content: center;
					align-items: center;
					padding: 20px;
				}

				.container {
					width: 100%;
					max-width: 800px;
					padding: 40px 20px;
					text-align: center;
				}

				.logo {
					margin-bottom: 2rem;
					transform: scale(1);
					transition: transform 0.3s ease;
				}

				.logo:hover {
					transform: scale(1.1);
				}

				.title {
					font-size: 2.5rem;
					font-weight: 600;
					margin-bottom: 1rem;
					background: linear-gradient(45deg, #cdd5dd, #e2e8f0); /* 修改为更亮的颜色 */
					-webkit-background-clip: text;
					-webkit-text-fill-color: transparent;
				}

				.tips a {
					color: #9ba1a6;
					text-decoration: none;
					border-bottom: 1px dashed #9ba1a6;
					transition: all 0.2s ease;
				}

				.tips a:hover {
					color: #fff;
					border-bottom-color: #fff;
				}

				.search-container {
					position: relative;
					max-width: 600px;
					margin: 2rem auto;
				}

				.search-input {
					width: 100%;
					height: 56px;
					padding: 0 60px 0 24px;
					font-size: 1rem;
					color: #1f2937;
					background: rgba(255, 255, 255, 0.9);
					border: 2px solid transparent;
					border-radius: 12px;
					box-shadow: var(--shadow);
					transition: all 0.3s ease;
				}

				.search-input:focus {
					border-color: var(--primary-color);
					background: white;
					outline: none;
					box-shadow: 0 0 0 3px rgba(0, 102, 255, 0.2);
				}

				.search-button {
					position: absolute;
					right: 8px;
					top: 50%;
					transform: translateY(-50%);
					width: 44px;
					height: 44px;
					border: none;
					border-radius: 8px;
					background: var(--primary-color);
					color: white;
					cursor: pointer;
					transition: all 0.2s ease;
				}

				.search-button:hover {
					background: var(--primary-hover);
					transform: translateY(-50%) scale(1.05);
				}

				.tips {
					margin-top: 2rem;
					color: rgba(255, 255, 255, 0.8);
					line-height: 1.6;
					text-align: left;		   /* 添加左对齐 */
					padding-left: 1.8rem;	   /* 与示例标题对齐 */
				}

				.example-title {
					color: #9ba1a6;
					margin-bottom: 1.5rem;
					font-size: 1rem;
					font-weight: 700;
					position: relative;
					padding-bottom: 0.8rem;
					border-bottom: 1px solid rgba(255, 255, 255, 0.1);
				}

				.example p {
  margin: 0.8rem 0;
  font-family: monospace;
  font-size: 0.95rem;
  color: rgba(255, 255, 255, 0.8);
  padding-left: 1.5rem;
  /* 修改行高增加可读性 */
  line-height: 1.4;
  /* 新增：处理长文本 */
  word-break: break-all;
}

				.example {
  margin-top: 2rem;
  padding: 1.8rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  text-align: left;
  border: 1px solid rgba(255, 255, 255, 0.1);
  /* 新增：防止内容溢出 */
  overflow-wrap: break-word;
  word-wrap: break-word;
}

				@media (max-width: 640px) {
					.container {
						padding: 20px;
					}

					.title {
						font-size: 2rem;
					}

					.search-input {
						height: 50px;
						font-size: 0.9rem;
					}

					.search-button {
						width: 38px;
						height: 38px;
					}

					
                 .example {
    padding: 1rem;
    font-size: 0.8rem;
    /* 移动端减少左右内边距 */
    padding-left: 1rem;
    padding-right: 1rem;
  }
				}
			</style>
		</head>
		<body>
			<div class="container">
				<center>
				<div class="logo">
					<a href="https://github.com/C018/CF-GitHub-Proxy" target="_blank">
						<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 98 96" fill="#ffffff">
							<path fill-rule="evenodd" clip-rule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"/>
						</svg>
					</a>
				</div>
				<h1 class="title">GitHub文件及api加速</h1>

				</center>
				<form onsubmit="toSubmit(event)" class="search-container">
					<input 
						type="text" 
						class="search-input"
						name="q" 
						placeholder="请输入GitHub文件or api链接"
						pattern="^((https|http)://)?(github.com/.+?/.+?/(?:releases|archive|blob|raw|suites|tree)|((?:raw|gist|api).(?:githubusercontent|github).com))/.+$" 
						required
					>
					<button type="submit" class="search-button">
						<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path d="M13 5l7 7-7 7M5 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					</button>
				</form>

				<div class="tips">
					<p>✨ 支持带协议头(https://)或不带的GitHub链接，api加速自2025.5.25已支持！更多用法见<a href="https://github.com/C018/CF-GitHub-Proxy#readme">项目说明</a></p>
					<p>🚀 release、archive 经 CF 转发；jsDelivr 跳转仅对 blob 分支文件生效，且需开启 Config.jsdelivr</p>
					<p>📦 文件夹下载已支持：在 /tree/{分支}/{目录} 链接前加上本代理域名，即可自动打包为 zip 下载</p>
				</div>

				<div class="example">
					<div class="example-title">📃 合法输入示例：</div>
					<p>📄 分支源码：https://github.com/octocat/Hello-World/archive/refs/heads/master.zip</p>
					<p>📁 release源码：https://github.com/BurntSushi/ripgrep/archive/refs/tags/14.1.1.tar.gz</p>
					<p>📂 release文件：https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-windows-amd64.exe</p>
					<p>💾 commit文件：https://github.com/octocat/Hello-World/blob/master/README</p>
					<p>🖨️ gist：https://gist.githubusercontent.com/octocat/6cad326836d38bd3a7ae/raw</p>
					<p>☁️ api：https://api.github.com/repos/C018/CF-GitHub-Proxy</p>
					<p>📦 文件夹下载：https://github.com/C018/CF-GitHub-Proxy/tree/main/src</p>
				</div>
				<p style="position: sticky;top: calc(100% - 2.5em);">
    由 <a style="color: #1E90FF" href="https://github.com/C018/CF-GitHub-Proxy" target="_blank">CF-GitHub-Proxy</a> 
    提供技术支持。
    在 <a style="color: #1E90FF" href="https://workers.cloudflare.com/" target="_blank">Cloudflare Workers</a> 
    上运行。
</p>
			</div>

			<script>
				function toSubmit(e) {
					e.preventDefault();
					const input = document.getElementsByName('q')[0];
					const baseUrl = location.href.substr(0, location.href.lastIndexOf('/') + 1);
					window.open(baseUrl + input.value);
				}
			<\/script>
		</body>
		</html>`
// 前缀，如果自定义路由为example.com/gh/*，将PREFIX改为 '/gh/'，注意，少一个杠都会错！
const PREFIX = '/'

const Config = {
    // 分支文件使用 jsDelivr 镜像的开关，0 为关闭，默认关闭
    jsdelivr: 0,
    // GitHub Token（可选，默认空字符串）：
    //   1) 提升 GitHub API 配额：匿名 60 次/小时 → 携带 Token 5000 次/小时；
    //   2) 支持打包/代理私有仓库内容。
    githubToken: ''
}

// 文件夹打包的保护性限制（可按需调整）
const ZIP_LIMITS = {
    maxFiles: 60,                     // 单次打包的文件数上限
    maxFileSize: 20 * 1024 * 1024,    // 单个文件体积上限（20MB）
    maxTotalSize: 40 * 1024 * 1024,   // 打包总体积上限（40MB）
    concurrency: 8                    // 并发抓取文件数
}

const UA = 'CF-GitHub-Proxy'

const whiteList = [] // 白名单，路径里面有包含字符的才会通过，e.g. ['/username/']

/** @type {ResponseInit} */
const PREFLIGHT_INIT = {
    status: 204,
    headers: new Headers({
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
        'access-control-max-age': '1728000',
    }),
}


const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i
const exp7 = /^(?:https?:\/\/)?api\.github\.com\/.*$/i
// 文件夹（tree）地址：https://github.com/{owner}/{repo}/tree/{ref}[/{子目录}]
const expTree = /^(?:https?:\/\/)?github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)(?:\/(.*))?$/i

/**
 * @param {any} body
 * @param {number} status
 * @param {Object<string, string>} headers
 */
function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*'
    return new Response(body, {status, headers})
}


/**
 * @param {string} urlStr
 */
function newUrl(urlStr) {
    try {
        return new URL(urlStr)
    } catch (err) {
        return null
    }
}


function checkUrl(u) {
    for (let i of [exp1, exp2, exp3, exp4, exp5, exp6, exp7]) {
        if (u.search(i) === 0) {
            return true
        }
    }
    return false
}


/* ------------------------------------------------------------------ *
 *  工具：HTML 提示页 / 体积格式化 / 文件名清洗
 * ------------------------------------------------------------------ */

/**
 * @param {any} str
 */
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
        return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]
    })
}

/**
 * @param {number} bytes
 */
function formatSize(bytes) {
    const n = Number(bytes) || 0
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
    return n + ' B'
}

/**
 * 清洗 zip / 附件文件名中不允许的字符
 * @param {string} name
 */
function sanitizeName(name) {
    const out = String(name).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')
    return out || 'download'
}

/**
 * 打包相关错误页中的「整仓库下载」链接
 * @param {string} proxyArchiveUrl
 */
function archiveLink(proxyArchiveUrl) {
    return '<p>可改用整仓库打包下载：<a href="' + escapeHtml(proxyArchiveUrl) + '">' + escapeHtml(proxyArchiveUrl) + '</a></p>'
}

/**
 * 自建 HTML 提示页。固定返回 HTTP 200，避免被上层 CDN 的错误页规则接管。
 * @param {string} host
 * @param {string} title
 * @param {string} message 纯文本提示（内部会转义）
 * @param {string} extraHtml 追加的 HTML 片段（调用方保证已转义）
 */
function infoResponse(host, title, message, extraHtml = '') {
    const base = 'https://' + host + PREFIX
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.7; background: #f6f7f9; color: #24292f; }
    .wrap { max-width: 760px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 28px 28px 20px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    h1 { font-size: 20px; margin: 0 0 12px; }
    h2 { font-size: 15px; margin: 24px 0 8px; color: #57606a; }
    p { margin: 8px 0; }
    .msg { padding: 10px 12px; background: #fff8e6; border: 1px solid #f0d9a0; border-radius: 8px; }
    ul { margin: 8px 0 0; padding-left: 20px; }
    li { margin: 6px 0; word-break: break-all; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
    a { color: #0969da; }
    .foot { margin-top: 24px; font-size: 12px; color: #8b949e; }
    @media (prefers-color-scheme: dark) {
        body { background: #0d1117; color: #c9d1d9; }
        .wrap { background: #161b22; border-color: #30363d; box-shadow: none; }
        h2 { color: #8b949e; }
        code { background: #21262d; }
        .msg { background: #2d2412; border-color: #5c4813; }
    }
</style>
</head>
<body>
<div class="wrap">
    <h1>${escapeHtml(title)}</h1>
    <p class="msg">${escapeHtml(message)}</p>
    ${extraHtml}
    <h2>支持的链接格式（在原始链接前加上本代理域名即可）</h2>
    <ul>
        <li>分支源码：<code>${escapeHtml(base)}https://github.com/owner/repo/archive/refs/heads/master.zip</code></li>
        <li>release 源码：<code>${escapeHtml(base)}https://github.com/owner/repo/archive/refs/tags/v0.1.0.tar.gz</code></li>
        <li>release 文件：<code>${escapeHtml(base)}https://github.com/owner/repo/releases/download/v0.1.0/example.zip</code></li>
        <li>分支 / commit 文件：<code>${escapeHtml(base)}https://github.com/owner/repo/blob/master/filename</code></li>
        <li>raw 文件：<code>${escapeHtml(base)}https://raw.githubusercontent.com/owner/repo/master/filename</code></li>
        <li>gist：<code>${escapeHtml(base)}https://gist.githubusercontent.com/user/id/raw/file</code></li>
        <li>GitHub API：<code>${escapeHtml(base)}https://api.github.com/repos/owner/repo</code></li>
        <li>文件夹打包下载：<code>${escapeHtml(base)}https://github.com/owner/repo/tree/master/src</code></li>
    </ul>
    <div class="foot">CF-GitHub-Proxy</div>
</div>
</body>
</html>`
    return new Response(html, {
        status: 200,
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'access-control-allow-origin': '*',
            'cache-control': 'no-store',
        },
    })
}


/* ------------------------------------------------------------------ *
 *  GitHub API（文件夹打包用）
 * ------------------------------------------------------------------ */

/**
 * 携带 UA 与可选 Token 的 GitHub 请求
 * @param {string} url
 * @param {string} accept
 */
function githubFetch(url, accept) {
    const headers = {
        'user-agent': UA,
        'accept': accept || 'application/vnd.github+json',
    }
    if (Config.githubToken) {
        headers['authorization'] = 'Bearer ' + Config.githubToken
    }
    return fetch(url, {headers})
}

/**
 * 读取一个 git tree
 * @returns {Promise<{entries?: any[], truncated?: boolean, error?: string, status?: number}>}
 */
async function apiGetTree(owner, repo, treeish, recursive) {
    const url = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
        '/git/trees/' + encodeURIComponent(treeish) + (recursive ? '?recursive=1' : '')
    let res
    try {
        res = await githubFetch(url)
    } catch (err) {
        return {error: 'network'}
    }
    if (res.status === 200) {
        let data
        try {
            data = await res.json()
        } catch (err) {
            return {error: 'payload'}
        }
        if (!data || !Array.isArray(data.tree)) return {error: 'payload'}
        return {entries: data.tree, truncated: Boolean(data.truncated)}
    }
    if (res.status === 403 || res.status === 429) return {error: 'quota'}
    if (res.status === 401) return {error: 'unauthorized'}
    if (res.status === 404) return {error: 'notfound'}
    return {error: 'http', status: res.status}
}

/**
 * 逐级下钻定位目标子目录（避免 `ref:path` 语法的兼容性差异），
 * 返回该子目录自身的递归文件树（条目 path 相对该子目录）。
 */
async function resolveSubTree(owner, repo, ref, subPath) {
    const parts = String(subPath).split('/').filter(Boolean)
    let current = await apiGetTree(owner, repo, ref, false)
    if (current.error) return current

    let sha = null
    for (let i = 0; i < parts.length; i++) {
        const node = current.entries.filter(function (item) {
            return item.path === parts[i] && item.type === 'tree'
        })[0]
        if (!node) {
            const isSubmodule = current.entries.some(function (item) {
                return item.path === parts[i] && item.type === 'commit'
            })
            return {error: isSubmodule ? 'submodule' : 'notfound'}
        }
        sha = node.sha
        if (i < parts.length - 1) {
            current = await apiGetTree(owner, repo, sha, false)
            if (current.error) return current
        }
    }
    return apiGetTree(owner, repo, sha, true)
}

/**
 * 抓取单个文件内容（优先 raw，失败后回退 GitHub API 的 raw 媒体类型）
 * @returns {Promise<{ok: boolean, data?: Uint8Array, status?: number}>}
 */
async function fetchBlob(owner, repo, ref, filePath) {
    const pathEncoded = String(filePath).split('/').map(encodeURIComponent).join('/')
    const refEncoded = String(ref).split('/').map(encodeURIComponent).join('/')

    const rawHeaders = {'user-agent': UA}
    if (Config.githubToken) rawHeaders['authorization'] = 'Bearer ' + Config.githubToken
    try {
        const rawRes = await fetch('https://raw.githubusercontent.com/' + encodeURIComponent(owner) + '/' +
            encodeURIComponent(repo) + '/' + refEncoded + '/' + pathEncoded, {headers: rawHeaders})
        if (rawRes.ok) {
            return {ok: true, data: new Uint8Array(await rawRes.arrayBuffer())}
        }
    } catch (err) {
        // 忽略，走 API 回退
    }

    const apiHeaders = {'user-agent': UA, 'accept': 'application/vnd.github.raw'}
    if (Config.githubToken) apiHeaders['authorization'] = 'Bearer ' + Config.githubToken
    try {
        const apiRes = await fetch('https://api.github.com/repos/' + encodeURIComponent(owner) + '/' +
            encodeURIComponent(repo) + '/contents/' + pathEncoded + '?ref=' + encodeURIComponent(ref),
            {headers: apiHeaders})
        if (apiRes.ok) {
            return {ok: true, data: new Uint8Array(await apiRes.arrayBuffer())}
        }
        return {ok: false, status: apiRes.status}
    } catch (err) {
        return {ok: false, status: 0}
    }
}


/* ------------------------------------------------------------------ *
 *  ZIP 打包（STORE 不压缩，自行实现 CRC32 与 zip 结构）
 * ------------------------------------------------------------------ */

/* ZIP_HELPERS_START */

let CRC_TABLE = null

/**
 * 计算 CRC32
 * @param {Uint8Array} buf
 */
function crc32(buf) {
    if (!CRC_TABLE) {
        CRC_TABLE = new Uint32Array(256)
        for (let i = 0; i < 256; i++) {
            let c = i
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
            }
            CRC_TABLE[i] = c >>> 0
        }
    }
    let crc = 0xFFFFFFFF
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF]
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
}

/**
 * 转换为 DOS 时间/日期
 * @param {Date} date
 */
function dosDateTime(date) {
    const d = date || new Date()
    const year = Math.max(1980, d.getUTCFullYear())
    return {
        time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
        date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    }
}

/**
 * 构建 STORE（不压缩）方式的 zip 字节流
 * 结构：本地文件头 + 文件数据 ... + 中央目录 + EOCD
 * @param {{name: string, data: Uint8Array|null}[]} entries
 * @param {Date} date
 * @returns {Uint8Array}
 */
function buildZip(entries, date) {
    const encoder = new TextEncoder()
    const dt = dosDateTime(date)
    const localParts = []
    const centralParts = []
    let offset = 0
    let count = 0

    for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name)
        const isDir = entry.name.endsWith('/')
        const data = (!isDir && entry.data) ? entry.data : new Uint8Array(0)
        const crc = isDir ? 0 : crc32(data)
        const size = data.length

        // 本地文件头 30 字节 + 文件名
        const local = new Uint8Array(30 + nameBytes.length)
        const lv = new DataView(local.buffer)
        lv.setUint32(0, 0x04034b50, true)        // 签名
        lv.setUint16(4, 20, true)                // version needed to extract
        lv.setUint16(6, 0x0800, true)            // 通用标志位：文件名为 UTF-8
        lv.setUint16(8, 0, true)                 // 压缩方法：0 = STORE
        lv.setUint16(10, dt.time, true)          // 最后修改时间
        lv.setUint16(12, dt.date, true)          // 最后修改日期
        lv.setUint32(14, crc, true)              // CRC32
        lv.setUint32(18, size, true)             // 压缩后大小
        lv.setUint32(22, size, true)             // 原始大小
        lv.setUint16(26, nameBytes.length, true) // 文件名长度
        lv.setUint16(28, 0, true)                // 扩展字段长度
        local.set(nameBytes, 30)

        // 中央目录项 46 字节 + 文件名
        const central = new Uint8Array(46 + nameBytes.length)
        const cv = new DataView(central.buffer)
        cv.setUint32(0, 0x02014b50, true)        // 签名
        cv.setUint16(4, 20, true)                // version made by
        cv.setUint16(6, 20, true)                // version needed to extract
        cv.setUint16(8, 0x0800, true)            // 通用标志位：文件名为 UTF-8
        cv.setUint16(10, 0, true)                // 压缩方法：0 = STORE
        cv.setUint16(12, dt.time, true)          // 最后修改时间
        cv.setUint16(14, dt.date, true)          // 最后修改日期
        cv.setUint32(16, crc, true)              // CRC32
        cv.setUint32(20, size, true)             // 压缩后大小
        cv.setUint32(24, size, true)             // 原始大小
        cv.setUint16(28, nameBytes.length, true) // 文件名长度
        cv.setUint16(30, 0, true)                // 扩展字段长度
        cv.setUint16(32, 0, true)                // 注释长度
        cv.setUint16(34, 0, true)                // 起始磁盘号
        cv.setUint16(36, 0, true)                // 内部属性
        cv.setUint32(38, isDir ? 0x10 : 0, true) // 外部属性（目录标记）
        cv.setUint32(42, offset, true)           // 本地文件头偏移
        central.set(nameBytes, 46)

        localParts.push(local, data)
        centralParts.push(central)
        offset += local.length + data.length
        count++
    }

    let centralSize = 0
    for (const part of centralParts) centralSize += part.length

    // EOCD
    const eocd = new Uint8Array(22)
    const ev = new DataView(eocd.buffer)
    ev.setUint32(0, 0x06054b50, true)  // 签名
    ev.setUint16(4, 0, true)           // 当前磁盘号
    ev.setUint16(6, 0, true)           // 中央目录起始磁盘号
    ev.setUint16(8, count, true)       // 本磁盘条目数
    ev.setUint16(10, count, true)      // 总条目数
    ev.setUint32(12, centralSize, true)
    ev.setUint32(16, offset, true)     // 中央目录偏移
    ev.setUint16(20, 0, true)          // 注释长度

    let total = centralSize + eocd.length
    for (const part of localParts) total += part.length

    const out = new Uint8Array(total)
    let pos = 0
    for (const part of localParts) {
        out.set(part, pos)
        pos += part.length
    }
    for (const part of centralParts) {
        out.set(part, pos)
        pos += part.length
    }
    out.set(eocd, pos)
    return out
}

/* ZIP_HELPERS_END */


/**
 * 处理 /https://github.com/{owner}/{repo}/tree/{ref}[/{subPath}] 请求
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref
 * @param {string} subPath
 * @param {string} host
 */
async function handleTreeRequest(owner, repo, ref, subPath, host) {
    const archiveUrl = 'https://github.com/' + owner + '/' + repo + '/archive/refs/heads/' + ref + '.zip'
    const proxyArchiveUrl = 'https://' + host + PREFIX + archiveUrl

    // 仅 /tree/{ref}（无子目录）：302 重定向到本代理自身的整仓库 archive
    if (!subPath) {
        return Response.redirect(proxyArchiveUrl, 302)
    }

    const tree = await resolveSubTree(owner, repo, ref, subPath)
    if (tree.error) {
        if (tree.error === 'quota') {
            return infoResponse(host, 'GitHub API 配额已耗尽',
                'GitHub API 的匿名配额（60 次/小时）已用完，暂时无法列出目录内容。可在代码顶部 Config.githubToken 中填入 GitHub Token，将配额提升到 5000 次/小时。',
                archiveLink(proxyArchiveUrl))
        }
        if (tree.error === 'unauthorized') {
            return infoResponse(host, 'GitHub 鉴权失败',
                '当前配置的 GitHub Token 无效或已过期，请检查 Config.githubToken。',
                archiveLink(proxyArchiveUrl))
        }
        if (tree.error === 'notfound') {
            return infoResponse(host, '目录不存在',
                '未能在 ' + owner + '/' + repo + ' 的 ' + ref + ' 分支下找到目录「' + subPath + '」，请检查 owner / repo / 分支名 / 目录路径是否正确。',
                archiveLink(proxyArchiveUrl))
        }
        if (tree.error === 'submodule') {
            return infoResponse(host, '暂不支持子模块',
                '目录「' + subPath + '」是 Git 子模块（submodule），其内容不在当前仓库内，无法打包。',
                archiveLink(proxyArchiveUrl))
        }
        if (tree.error === 'network') {
            return infoResponse(host, '网络异常',
                '访问 GitHub API 失败（网络异常），请稍后重试。',
                archiveLink(proxyArchiveUrl))
        }
        return infoResponse(host, '读取目录失败',
            '访问 GitHub API 失败（HTTP ' + (tree.status || '未知') + '），请稍后重试。',
            archiveLink(proxyArchiveUrl))
    }

    if (tree.truncated) {
        return infoResponse(host, '目录过大',
            '该目录文件数量过多，GitHub API 返回的文件树被截断，无法保证打包完整，已中止。',
            archiveLink(proxyArchiveUrl))
    }

    const blobs = tree.entries.filter(function (item) {
        return item.type === 'blob'
    })
    const treeDirs = tree.entries.filter(function (item) {
        return item.type === 'tree'
    })

    if (!blobs.length) {
        return infoResponse(host, '目录为空',
            '该目录下没有可打包的文件。',
            archiveLink(proxyArchiveUrl))
    }

    if (blobs.length > ZIP_LIMITS.maxFiles) {
        return infoResponse(host, '文件数超出上限',
            '该目录包含 ' + blobs.length + ' 个文件，超过单次打包上限 ' + ZIP_LIMITS.maxFiles + ' 个。',
            archiveLink(proxyArchiveUrl))
    }

    let totalSize = 0
    for (const blob of blobs) {
        const size = Number(blob.size) || 0
        if (size > ZIP_LIMITS.maxFileSize) {
            return infoResponse(host, '存在超大文件',
                '文件 ' + blob.path + '（' + formatSize(size) + '）超过单文件体积上限 ' + formatSize(ZIP_LIMITS.maxFileSize) + '。',
                archiveLink(proxyArchiveUrl))
        }
        totalSize += size
    }
    if (totalSize > ZIP_LIMITS.maxTotalSize) {
        return infoResponse(host, '打包体积超出上限',
            '该目录总体积约 ' + formatSize(totalSize) + '，超过单次打包体积上限 ' + formatSize(ZIP_LIMITS.maxTotalSize) + '。',
            archiveLink(proxyArchiveUrl))
    }

    // 并发抓取文件内容
    const files = new Array(blobs.length)
    let cursor = 0
    let failure = null

    async function runner() {
        while (true) {
            const index = cursor++
            if (index >= blobs.length || failure) return
            const blob = blobs[index]
            const res = await fetchBlob(owner, repo, ref, subPath + '/' + blob.path)
            if (!res.ok) {
                failure = {path: blob.path, reason: 'fetch', status: res.status}
                return
            }
            if (res.data.length > ZIP_LIMITS.maxFileSize) {
                failure = {path: blob.path, reason: 'size'}
                return
            }
            files[index] = res.data
        }
    }

    const runners = []
    const runnerCount = Math.min(ZIP_LIMITS.concurrency, blobs.length)
    for (let i = 0; i < runnerCount; i++) runners.push(runner())
    await Promise.all(runners)

    if (failure) {
        const detail = failure.reason === 'size'
            ? '抓取后体积超过单文件上限'
            : ('抓取失败，HTTP 状态码 ' + (failure.status || '未知'))
        return infoResponse(host, '打包失败',
            '文件 ' + failure.path + ' ' + detail + '，已中止打包（不返回残缺的 zip）。',
            archiveLink(proxyArchiveUrl))
    }

    // 组装 zip 条目：目录在前，文件在后
    const dirSet = new Set()
    for (const dir of treeDirs) {
        const p = String(dir.path || '').replace(/^\/+|\/+$/g, '')
        if (p) dirSet.add(p + '/')
    }
    for (const blob of blobs) {
        const parts = String(blob.path).split('/')
        for (let i = 1; i < parts.length; i++) {
            dirSet.add(parts.slice(0, i).join('/') + '/')
        }
    }

    const zipEntries = []
    for (const name of Array.from(dirSet).sort()) {
        zipEntries.push({name: name, data: null})
    }
    for (let i = 0; i < blobs.length; i++) {
        zipEntries.push({name: blobs[i].path, data: files[i]})
    }

    const zipData = buildZip(zipEntries, new Date())

    const fileName = sanitizeName(repo) + '-' + sanitizeName(ref) + '-' + sanitizeName(subPath) + '.zip'
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_')

    return new Response(zipData, {
        status: 200,
        headers: {
            'content-type': 'application/zip',
            'content-disposition': 'attachment; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodeURIComponent(fileName),
            'content-length': String(zipData.length),
            'access-control-allow-origin': '*',
            'cache-control': 'no-store',
        },
    })
}


/* ------------------------------------------------------------------ *
 *  请求分发
 * ------------------------------------------------------------------ */

/**
 * @param {Request} req
 */
async function fetchHandler(req) {
    const urlObj = new URL(req.url)
    const host = urlObj.host

    let path = urlObj.searchParams.get('q')
    if (path) {
        return Response.redirect('https://' + urlObj.host + PREFIX + path, 301)
    }
    // cfworker 会把路径中的 `//` 合并成 `/`
    path = urlObj.href.substr(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')

    // 规则匹配用的路径（去掉 query / hash，避免干扰）
    const routePath = path.split('#')[0].split('?')[0]

    // 首页：直接返回本地内置 HTML
    if (routePath === '' || routePath === '/') {
        return new Response(HOME_HTML, {
            status: 200,
            headers: {
                'content-type': 'text/html; charset=utf-8',
                'access-control-allow-origin': '*',
                'cache-control': 'no-store',
            },
        })
    }

    // 文件夹（tree）打包下载
    const treeMatch = routePath.match(expTree)
    if (treeMatch) {
        let subPath = (treeMatch[4] || '').replace(/\/+$/, '')
        try {
            subPath = decodeURIComponent(subPath)
        } catch (err) {
            // 保留原始值
        }
        return handleTreeRequest(treeMatch[1], treeMatch[2], treeMatch[3], subPath, host)
    }

    if (path.search(exp7) === 0) {
        return httpHandler(req, path)
    } else if (path.search(exp1) === 0 || path.search(exp5) === 0 || path.search(exp6) === 0 || path.search(exp3) === 0 || path.search(exp4) === 0) {
        return httpHandler(req, path)
    } else if (path.search(exp2) === 0) {
        if (Config.jsdelivr) {
            const newUrl = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh')
            return Response.redirect(newUrl, 302)
        } else {
            path = path.replace('/blob/', '/raw/')
            return httpHandler(req, path)
        }
    } else {
        // 未命中任何转发规则：直接返回自建提示页（HTTP 200），避免被上层 CDN 的默认 404 页面接管
        return infoResponse(host, '未匹配到可代理的链接',
            '该路径不在本代理支持的范围内，请参考下方支持的链接格式。')
    }
}


/**
 * @param {Request} req
 * @param {string} pathname
 */
function httpHandler(req, pathname) {
    const reqHdrRaw = req.headers

    // preflight
    if (req.method === 'OPTIONS' &&
        reqHdrRaw.has('access-control-request-headers')
    ) {
        return new Response(null, PREFLIGHT_INIT)
    }

    const reqHdrNew = new Headers(reqHdrRaw)

    let urlStr = pathname
    let flag = !Boolean(whiteList.length)
    for (let i of whiteList) {
        if (urlStr.includes(i)) {
            flag = true
            break
        }
    }
    if (!flag) {
        return new Response("blocked", {status: 403})
    }
    if (urlStr.search(/^https?:\/\//) !== 0) {
        urlStr = 'https://' + urlStr
    }
    const urlObj = newUrl(urlStr)

    /** @type {RequestInit} */
    const reqInit = {
        method: req.method,
        headers: reqHdrNew,
        redirect: 'manual',
        body: req.body
    }
    return proxy(urlObj, reqInit)
}


/**
 *
 * @param {URL} urlObj
 * @param {RequestInit} reqInit
 */
async function proxy(urlObj, reqInit) {
    const res = await fetch(urlObj.href, reqInit)
    const resHdrOld = res.headers
    const resHdrNew = new Headers(resHdrOld)

    const status = res.status

    if (resHdrNew.has('location')) {
        let _location = resHdrNew.get('location')
        if (checkUrl(_location))
            resHdrNew.set('location', PREFIX + _location)
        else {
            reqInit.redirect = 'follow'
            return proxy(newUrl(_location), reqInit)
        }
    }
    resHdrNew.set('access-control-expose-headers', '*')
    resHdrNew.set('access-control-allow-origin', '*')

    resHdrNew.delete('content-security-policy')
    resHdrNew.delete('content-security-policy-report-only')
    resHdrNew.delete('clear-site-data')

    return new Response(res.body, {
        status,
        headers: resHdrNew,
    })
}


export default {
    async fetch(request) {
        try {
            return await fetchHandler(request)
        } catch (err) {
            return makeRes('cfworker error:\n' + err.stack, 502)
        }
    }
}
