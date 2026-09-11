'use strict'

/**
 * CF-Workers-GitHub-Proxy — Cloudflare Snippets 版
 *
 * 功能：
 *  1. 代理 GitHub release / archive / blob / raw / gist / tags / api 资源（保留 jsDelivr 开关）；
 *  2. 新增「文件夹下载」：https://{代理域名}/https://github.com/{owner}/{repo}/tree/{ref}/{子目录}
 *     通过 GitHub API 递归获取文件清单 → 并发抓取文件内容 → 在 Worker 内存内打包为 zip（STORE 不压缩）返回；
 *  3. 未命中任何转发规则的路径返回自建 HTML 提示页（HTTP 200），避免被上层 CDN 的默认 404 页面接管。
 *
 * 零依赖单文件，可直接粘贴到 Cloudflare Snippets 编辑器运行。
 */

const ASSET_URL = 'https://geekertao.github.io/gh-proxy/'
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

const UA = 'CF-Workers-GitHub-Proxy'

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
        <li>分支源码：<code>${escapeHtml(base)}https://github.com/owner/repo/archive/master.zip</code></li>
        <li>release 源码：<code>${escapeHtml(base)}https://github.com/owner/repo/archive/v0.1.0.tar.gz</code></li>
        <li>release 文件：<code>${escapeHtml(base)}https://github.com/owner/repo/releases/download/v0.1.0/example.zip</code></li>
        <li>分支 / commit 文件：<code>${escapeHtml(base)}https://github.com/owner/repo/blob/master/filename</code></li>
        <li>raw 文件：<code>${escapeHtml(base)}https://raw.githubusercontent.com/owner/repo/master/filename</code></li>
        <li>gist：<code>${escapeHtml(base)}https://gist.githubusercontent.com/user/id/raw/file</code></li>
        <li>GitHub API：<code>${escapeHtml(base)}https://api.github.com/repos/owner/repo</code></li>
        <li>文件夹打包下载：<code>${escapeHtml(base)}https://github.com/owner/repo/tree/master/src</code></li>
    </ul>
    <div class="foot">CF-Workers-GitHub-Proxy</div>
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

    // 首页：优先返回 ASSET_URL 页面，拉取失败时回落本地提示页
    if (routePath === '' || routePath === '/') {
        try {
            const res = await fetch(ASSET_URL)
            if (res.ok) return res
        } catch (err) {
            // 忽略，回落本地提示页
        }
        return infoResponse(host, 'GitHub 加速代理', '在任意 GitHub 链接前加上本代理域名即可加速下载。')
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
    } else if (path.search(exp4) === 0) {
        const newUrl = path.replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1').replace(/^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/, 'https://cdn.jsdelivr.net/gh')
        return Response.redirect(newUrl, 302)
    } else {
        // 未命中任何转发规则：先尝试从 ASSET_URL 取该路径的静态资源（如 /favicon.ico 及页面相对资源）
        try {
            const assetRes = await fetch(ASSET_URL + path)
            if (assetRes.status !== 404) {
                return assetRes
            }
        } catch (err) {
            // 请求抛错：回落到自建提示页
        }
        // 静态资源不存在（404）或请求失败：返回自建提示页（HTTP 200），避免被上层 CDN 的默认 404 页面接管
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
