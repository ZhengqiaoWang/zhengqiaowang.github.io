/*
 * 图库处理核心：压缩 → 盲水印 → 缩略图 → 记录字段
 * 命令行（build.mjs）和本地上传页（server.mjs）都调这里，保证两条路产出完全一致。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import BlindWatermark from '../../assets/vendor/blind-watermark/index.mjs';
import { readExif } from './exif.mjs';

export { readExif };


export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const STATE_FILE = path.join(ROOT, 'scripts/gallery/.state.json');

/* ---------------- 小工具 ---------------- */

const IMAGE_RE = /\.(jpe?g|png|webp|tiff?|heic|heif)$/i;
export const pad = (n, w = 2) => String(n).padStart(w, '0');
export const kb = (n) => `${Math.round(n / 1024)}KB`;

export function slug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** EXIF 里 2025:10:22 09:07:18 这种「时区不明」的时间，按墙上时间理解 */
export function exifDate(v) {
  if (!v) return null;
  if (v instanceof Date) return new Date(v.getTime() + v.getTimezoneOffset() * 60000);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return new Date(s.slice(0, 19));
  if (/^\d{4}[:\-]\d{2}[:\-]\d{2}/.test(s)) {
    const [d, t = '00:00:00'] = s.split(/[ T]/);
    return new Date(`${d.replace(/:/g, '-')}T${t.slice(0, 8)}`);
  }
  return null;
}

export const fmtYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 曝光时间：0.003125 → 1/320；1 → 1s；2.5 → 2.5s */
export function shutterText(v) {
  const n = Number(v);
  if (!n || Number.isNaN(n)) return null;
  if (n >= 1) return `${Number(n.toFixed(1))}s`;
  return `1/${Math.round(1 / n)}`;
}

export const lensText = (t) => (t.LensModel || t.LensID || t.Lens || '').toString().trim() || null;
export const cameraText = (t) => {
  const make = String(t.Make || '').trim();
  const model = String(t.Model || '').trim();
  if (!model) return make || null;
  // 有些机器 Model 里已经带了厂牌（Canon EOS R5），就别再拼一遍
  if (!make || model.toLowerCase().startsWith(make.toLowerCase())) return model;
  return `${make} ${model}`;
};

/* ---------------- 字段兼容（exiftool / exifr 叫法不同） ---------------- */

const constFocal = (m) => (m.FocalLength ? `${Math.round(Number(m.FocalLength))}mm` : null);
const constAperture = (m) => (m.FNumber ? `f/${Number(m.FNumber)}` : null);
const constExposure = (m) => m.ExposureTime ?? m.ShutterSpeedValue ?? null;
const constIso = (m) => {
  const v = m.ISO ?? m.ISOSpeedRatings ?? m.PhotographicSensitivity ?? null;
  const n = Array.isArray(v) ? v[0] : v;
  return n ? `ISO ${n}` : null;
};

/* ---------------- 逆地理 ---------------- */

/** 中国省级行政区（含直辖市、自治区、特别行政区）的粗略边界框，够用来判断落在哪个省 */
const CHINA_PROVINCES = [
  ['北京市', 39.4, 41.1, 115.4, 117.5],
  ['天津市', 38.5, 40.3, 116.7, 118.1],
  ['河北省', 36.0, 42.7, 113.4, 119.9],
  ['山西省', 34.5, 40.8, 110.1, 114.6],
  ['内蒙古自治区', 37.3, 53.4, 97.1, 126.1],
  ['辽宁省', 38.7, 43.5, 118.8, 125.8],
  ['吉林省', 40.8, 46.4, 121.6, 131.3],
  ['黑龙江省', 43.4, 53.6, 121.1, 135.1],
  ['上海市', 30.6, 31.9, 120.8, 122.1],
  ['江苏省', 30.7, 35.2, 116.3, 121.9],
  ['浙江省', 27.0, 31.2, 118.0, 123.2],
  ['安徽省', 29.3, 34.7, 114.8, 119.7],
  ['福建省', 23.5, 28.4, 115.8, 120.7],
  ['江西省', 24.4, 30.1, 113.5, 118.5],
  ['山东省', 34.3, 38.4, 114.8, 122.7],
  ['河南省', 31.3, 36.4, 110.3, 116.7],
  ['湖北省', 29.0, 33.3, 108.3, 116.2],
  ['湖南省', 24.6, 30.2, 108.7, 114.3],
  ['广东省', 20.2, 25.6, 109.6, 117.4],
  ['广西壮族自治区', 20.8, 26.4, 104.4, 112.1],
  ['海南省', 18.1, 20.2, 108.5, 111.1],
  ['重庆市', 28.1, 32.3, 105.2, 110.3],
  ['四川省', 26.0, 34.4, 97.3, 108.6],
  ['贵州省', 24.5, 29.2, 103.5, 109.6],
  ['云南省', 21.1, 29.3, 97.4, 106.3],
  ['西藏自治区', 26.8, 36.5, 78.3, 99.2],
  ['陕西省', 31.6, 39.6, 105.4, 111.3],
  ['甘肃省', 32.5, 42.8, 92.1, 108.8],
  ['青海省', 31.5, 39.3, 89.3, 103.1],
  ['宁夏回族自治区', 35.2, 39.4, 104.2, 107.7],
  ['新疆维吾尔自治区', 34.2, 49.3, 73.4, 96.5],
  ['台湾省', 21.8, 25.4, 119.3, 122.1],
  ['香港特别行政区', 22.1, 22.6, 113.8, 114.5],
  ['澳门特别行政区', 22.0, 22.3, 113.4, 113.7],
];

/** 把省份名缩成「图上愿意看」的两个字：四川省 → 四川 */
export function shortRegion(name) {
  return name.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔|自治州)$/g, '') || name;
}

export function provinceOf(lat, lon) {
  if (lat == null || lon == null) return null;
  for (const [name, s, n, w, e] of CHINA_PROVINCES) {
    if (lat >= s && lat <= n && lon >= w && lon <= e) return name;
  }
  return null;
}

/**
 * 由 GPS 推城市名。没有 GPS 就返回 null，留给人工在 JSON 里补。
 * 这里刻意不接在线地图 API：一是发布时离线可用，二是不想把每张照片的坐标发给第三方。
 */
export function cityFromGps(lat, lon) {
  if (lat == null || lon == null) return null;
  const prov = provinceOf(lat, lon);
  if (prov) {
    // 直辖市直接用市名；其余省份用省简称占位，用户可在 JSON 里改成具体城市
    if (/^(北京|天津|上海|重庆|香港|澳门)/.test(prov)) return prov.replace(/市$/, '');
    return shortRegion(prov);
  }
  return null;
}

/* ---------------- 状态（用于「原片已不在也能复查」） ---------------- */

export async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return { photos: {} };
  }
}

export async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

/* ---------------- 主流程 ---------------- */

export async function listSources(p) {
  const st = await fs.stat(p);
  if (st.isFile()) return IMAGE_RE.test(p) ? [p] : [];
  const entries = await fs.readdir(p, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(p, e.name);
    if (e.isDirectory()) files.push(...await listSources(full));
    else if (IMAGE_RE.test(e.name) && !e.name.startsWith('.')) files.push(full);
  }
  return files.sort();
}


/* ---------------- 一张照片：压缩 → 水印 → 缩略图 ---------------- */

export const WATERMARK_TEXT = 'www.zhengqiao.wang';

/**
 * 把一张原片的 Buffer 做成上架用的成品。
 * 顺序是硬约束：先压到最终尺寸，再把水印写在这份像素上，产物原样存盘不重编码。
 * @returns {Promise<{jpg: Buffer, thumb: Buffer, w: number, h: number, watermarked: string}>}
 */
export async function processPhoto(raw, opts = {}) {
    const width = opts.width || 1600;
    const quality = opts.quality || 85;
    const text = opts.watermark || WATERMARK_TEXT;

    const pre = await sharp(raw, { limitInputPixels: false, failOn: 'none' })
        .rotate()                                  // 按 EXIF 方向摆正，之后 EXIF 全丢，GPS 也不会跟出去
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
    const meta = await sharp(pre).metadata();

    const bwm = new BlindWatermark();
    const wm = Buffer.from(await bwm.embed(new Uint8Array(pre), text, 'jpg'));

    // 立刻读回来验证：读不回就别写进仓库
    const back = await bwm.extract(new Uint8Array(wm));
    if (!back || !back.valid || back.text !== text) {
        throw new Error('水印写入后读不回来');
    }

    const thumb = await sharp(wm, { limitInputPixels: false, failOn: 'none' })
        .resize({ width: 720, withoutEnlargement: true })
        .webp({ quality: 76 })
        .toBuffer();

    return { jpg: wm, thumb, w: meta.width, h: meta.height, watermarked: text };
}

/** 用 EXIF 结果拼出 photos.json 里的一条记录（不含 id） */
export function makeRecord(meta, opts = {}) {
    const shift = opts.shift || 0;
    const shot = exifDate(meta.DateTimeOriginal || meta.CreateDate || meta.ModifyDate);
    if (!shot) throw new Error('照片没有拍摄时间');
    const date = fmtYMD(new Date(shot.getTime() + shift * 3600000));

    const lat = typeof meta.GPSLatitude === 'number' ? meta.GPSLatitude : null;
    const lon = typeof meta.GPSLongitude === 'number' ? meta.GPSLongitude : null;
    const city = opts.city || cityFromGps(lat, lon) || '待定';

    return {
        title: (opts.title || '').trim() || null,
        city,
        date,
        hasGps: Boolean(opts.city) || cityFromGps(lat, lon) != null,
        tags: [...new Set(opts.tags || [])],
        camera: cameraText(meta),
        lens: lensText(meta),
        focal: constFocal(meta),
        f: constAperture(meta),
        shutter: shutterText(constExposure(meta)),
        iso: constIso(meta),
        collection: opts.album || null,
    };
}

export function fileNameFor(record, seq) {
    return `${record.date}-${slug(record.city) || 'photo'}-${pad(seq)}`;
}
