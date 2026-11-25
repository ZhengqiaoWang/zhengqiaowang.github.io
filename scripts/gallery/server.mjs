#!/usr/bin/env node
/*
 * 图库本地上传页
 *
 *   node scripts/gallery/server.mjs
 *
 * 浏览器会自动打开 http://127.0.0.1:8788 —— 选一批原片进去，填标签和相册名，
 * 点「开始处理」。图片直接写进 assets/gallery，photos.json 自动更新，
 * 剩下的就是 git commit && push。
 *
 * 只用 Node 自带的东西（http / fs），不装服务端框架。
 * 服务只监听 127.0.0.1；页面里的 API 请求要带上一串本次启动才生成的随机令牌，
 * 别的网站没法跨站往你仓库里写东西。
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';


import {
  ROOT, processPhoto, makeRecord, fileNameFor,
  readState, writeState, readExif,
  WATERMARK_TEXT,
} from './lib.mjs';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT) || 8788;
const HOST = '127.0.0.1';
const TOKEN = randomBytes(16).toString('hex');

const OUT_DIR = path.join(ROOT, 'assets/gallery');
const DATA_FILE = path.join(OUT_DIR, 'photos.json');
const UI_FILE = path.join(ROOT, 'scripts/gallery/upload.html');
const TMP_DIR = path.join(ROOT, 'scripts/gallery/.incoming');

/* ---------------- 小工具 ---------------- */

const json = (res, code, obj) => {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' });
  res.end(buf);
};

async function body(req, limit = 320 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) {
      throw new Error(
        '这一批太大了（超过 ' + Math.round(limit / 1048576) + 'MB），少选几张再来一次'
      );
    }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readPhotos() {
  try {
    const j = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    return Array.isArray(j.photos) ? j.photos : [];
  } catch {
    return [];
  }
}

async function writePhotos(photos, watermark = WATERMARK_TEXT) {
  photos.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(a.id).localeCompare(String(b.id))));
  await fs.mkdir(OUT_DIR, { recursive: true });
  const out = { photos, generatedAt: new Date().toISOString(), watermark };
  await fs.writeFile(DATA_FILE, JSON.stringify(out, null, 2) + '\n');
  return out;
}

const digest = (buf) => createHash('sha256').update(buf).digest('hex');

/** 同一天已有的最大编号 */
function maxSeq(photos, date) {
  let max = 0;
  for (const p of photos) {
    if (typeof p.id === 'string' && p.id.startsWith(`${date}-`)) {
      const n = Number(p.id.slice(-2));
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

const safeName = (s) => path.basename(String(s || 'photo')).replace(/[^\w.\-()\u4e00-\u9fa5]/g, '_');

/* ---------------- 接口 ---------------- */

const routes = {
  /** 初始化：库里现有多少张、有哪些标签和相册可以复用 */
  async meta(req, res) {
    const photos = await readPhotos();
    const tags = new Map();
    const albums = new Set();
    for (const p of photos) {
      for (const t of p.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
      if (p.collection) albums.add(p.collection);
    }
    json(res, 200, {
      count: photos.length,
      tags: [...tags].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
      albums: [...albums].sort(),
      watermark: WATERMARK_TEXT,
      outDir: path.relative(ROOT, OUT_DIR).split(path.sep).join('/'),
    });
  },

  /** 只读 EXIF，给界面预填城市/时间，不动任何文件 */
  async exif(req, res) {
    const files = JSON.parse((await body(req)).toString('utf8') || '[]');
    await fs.mkdir(TMP_DIR, { recursive: true });
    const dir = await fs.mkdtemp(path.join(TMP_DIR, 'scan-'));
    const saved = [];
    try {
      for (const [i, f] of files.entries()) {
        const raw = Buffer.from(String(f.data || ''), 'base64');
        const p = path.join(dir, `${String(i).padStart(3, '0')}-${safeName(f.name)}`);
        await fs.writeFile(p, raw);
        saved.push({ p, name: safeName(f.name), raw });
      }
      const exif = await Promise.race([
        readExif(saved.map((s) => s.p), {}),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('读照片信息超时：exiftool 60 秒没有回应')), 60000)
        ),
      ]);
      const byPath = new Map(exif.map((m) => [path.basename(m.SourceFile || ''), m]));
      const out = saved.map((s) => {
        const meta = byPath.get(path.basename(s.p)) || {};
        let rec = null;
        try {
          rec = makeRecord(meta, {});
        } catch {
          /* 没有拍摄时间的照片在这里就会露出来 */
        }
        return {
          name: s.name,
          size: s.raw.length,
          sha: digest(s.raw),
          ok: Boolean(rec),
          date: rec?.date || null,
          city: rec?.city || null,
          hasGps: rec?.hasGps || false,
          camera: rec?.camera || null,
          lens: rec?.lens || null,
          focal: rec?.focal || null,
          f: rec?.f || null,
          shutter: rec?.shutter || null,
          iso: rec?.iso || null,
        };
      });
      json(res, 200, { files: out });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },

  /** 真正处理：压缩 → 水印 → 读回校验 → 缩略图 → 落盘 → 更新 photos.json */
  async publish(req, res) {
    const payload = JSON.parse((await body(req)).toString('utf8'));
    const tags = [...new Set((payload.tags || []).map((t) => String(t).trim()).filter(Boolean))];
    const album = String(payload.album || '').trim() || null;
    const cityOverride = String(payload.city || '').trim() || null;
    const shift = Number(payload.shift) || 0;
    const force = Boolean(payload.force);
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!files.length) return json(res, 400, { error: '没有选中照片' });

    await fs.mkdir(OUT_DIR, { recursive: true });
    const state = await readState();
    state.photos ||= {};
    const photos = await readPhotos();
    const bySha = new Map(photos.filter((p) => p.source).map((p) => [p.source, p]));

    await fs.mkdir(TMP_DIR, { recursive: true });
    const dir = await fs.mkdtemp(path.join(TMP_DIR, 'run-'));
    const results = [];
    try {
      for (const f of files) {
        const name = safeName(f.name);
        const raw = Buffer.from(String(f.data || ''), 'base64');
        const sha = digest(raw);
        try {
          if (bySha.has(sha) && !force) {
            results.push({ name, status: 'skip', id: bySha.get(sha).id, note: '这张已经在库里了' });
            continue;
          }
          const tmp = path.join(dir, name);
          await fs.writeFile(tmp, raw);
          const meta = (await readExif([tmp], {}))[0] || {};
          // 每张照片可以单独命名；没命名就别写空字符串，让前端退回「城市 · 日期」
          const title = String(f.title || '').trim() || null;
          const rec = makeRecord(meta, { tags, album, city: cityOverride, shift, title });

          const seq = maxSeq(photos, rec.date) + 1;
          const base = fileNameFor(rec, seq);
          const still = await processPhoto(raw, {});

          await fs.writeFile(path.join(OUT_DIR, `${base}.jpg`), still.jpg);
          await fs.writeFile(path.join(OUT_DIR, `${base}-t.webp`), still.thumb);

          const photo = {
            id: base,
            src: `assets/gallery/${base}.jpg`,
            thumb: `assets/gallery/${base}-t.webp`,
            w: still.w,
            h: still.h,
            ...rec,
            source: sha,
          };
          const at = photos.findIndex((p) => p.source === sha);
          if (at >= 0) photos.splice(at, 1);   // force 重做时替换旧记录
          photos.push(photo);
          bySha.set(sha, photo);
          // 和 build.mjs 共用同一份状态文件，两条通道混着用也不会互相看不见
          state.photos[base] = { sha, file: name, createdAt: new Date().toISOString() };

          results.push({
            name, status: 'ok', id: base,
            size: still.jpg.length, thumb: still.thumb.length,
            city: rec.city, date: rec.date,
          });
        } catch (e) {
          results.push({ name, status: 'fail', note: e.message });
        }
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }

    await writeState(state);
    const out = await writePhotos(photos);
    json(res, 200, {
      results,
      count: out.photos.length,
      added: results.filter((r) => r.status === 'ok').length,
    });
  },
};

/* ---------------- HTTP ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = url.pathname;

  try {
    // 页面本身不带令牌（地址栏里不放秘密），页面拿到后再放进请求头
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const html = await fs.readFile(UI_FILE, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(html.replace('__TOKEN__', TOKEN));
    }

    // 处理完直接看图
    if (req.method === 'GET' && p.startsWith('/file/')) {
      const abs = path.resolve(OUT_DIR, decodeURIComponent(p.slice('/file/'.length)));
      if (!abs.startsWith(OUT_DIR + path.sep) || !existsSync(abs)) return void res.writeHead(404).end();
      const ext = path.extname(abs).toLowerCase();
      const type = ext === '.webp' ? 'image/webp' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      return void createReadStream(abs).pipe(res);
    }

    if (p === '/api/meta' && req.method === 'GET') {
      if (url.searchParams.get('t') !== TOKEN) return json(res, 403, { error: '令牌不对，重新打开命令行里给出的链接' });
      return await routes.meta(req, res);
    }

    if (p.startsWith('/api/') && req.method === 'POST') {
      if (req.headers['x-gallery-token'] !== TOKEN) return json(res, 403, { error: '令牌不对，重新打开命令行里给出的链接' });
      const fn = routes[p.slice('/api/'.length)];
      if (!fn) return json(res, 404, { error: '没有这个接口' });
      return await fn(req, res);
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
  } catch (e) {
    // 把真实错误也打到终端，浏览器弹窗里只给一句人话
    console.error('  ✗ 出错了：' + String((e && e.message) || e));
    if (!res.headersSent) json(res, 500, { error: friendlyError(e) });
    else res.end();
  }
});

/** 把底层错误翻成一句能看懂的话，原始堆栈留在终端 */
function friendlyError(e) {
  const msg = String((e && e.message) || e);
  if (/EPERM|spawn/i.test(msg)) {
    return '调不起来 exiftool：' + msg + '（终端里有完整堆栈）';
  }
  return msg;
}

server.listen(PORT, HOST, async () => {
  const link = `http://${HOST}:${PORT}/`;
  console.log(`
  图库上传页已启动
  ${link}

  图片写进   ${path.relative(ROOT, OUT_DIR).split(path.sep).join('/')}
  数据写入   ${path.relative(ROOT, DATA_FILE).split(path.sep).join('/')}

  处理完记得 git add / commit / push，推上去了 Pages 才会更新。
  关闭：这个窗口按 Ctrl+C。
`);
  if (process.platform === 'win32') {
    try {
      await execFileAsync('cmd', ['/c', 'start', '', link], { windowsHide: true });
    } catch {
      /* 打不开浏览器就手点上面的链接 */
    }
  } else {
    try {
      await execFileAsync(process.platform === 'darwin' ? 'open' : 'xdg-open', [link]);
    } catch {
      /* 同上 */
    }
  }
});

