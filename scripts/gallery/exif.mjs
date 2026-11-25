/*
 * EXIF 读取：默认走 exifr（纯 JS，起不了子进程也照样能用，这才是可靠的那条）；
 * 想让 exiftool 来读（字段更全，比如老机器的镜头 ID）可以设环境变量
 *   GALLERY_EXIFTOOL=1
 * 它会去调 node_modules 里自带的 exiftool.exe，那一步在部分 Windows 安全策略下会被拦。
 */
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const USE_EXIFTOOL = process.env.GALLERY_EXIFTOOL === '1';

const EXIFR_OPTS = {
  tiff: true,
  ifd0: true,
  exif: true,
  gps: true,
  interop: true,
  translateValues: false,
  reviveValues: false,
  mergeOutput: true,
  // 原始像素尺寸交给 sharp，exifr 只拿元数据
  pick: undefined,
};

/** 读一张：返回 { SourceFile, ...字段 }，失败返回 {} */
async function readOne(file) {
  try {
    const [buf, meta] = await Promise.all([readFile(file), sharp(file).metadata()]);
    const exifr = (await import('exifr')).default;
    const raw = (await exifr.parse(buf, EXIFR_OPTS)) || {};
    return {
      ...raw,
      SourceFile: file,
      // 宽高以 sharp 实际解码的为准，EXIF 里的可能是旋转前的
      ImageWidth: meta.width,
      ImageHeight: meta.height,
      Orientation: raw.Orientation ?? meta.orientation ?? 1,
    };
  } catch {
    return {};
  }
}

/** exiftool 路线（可选，默认不用） */
async function readViaExiftool(files) {
  const { readExifTool } = await import('./exiftool.mjs');
  return readExifTool(files);
}

/**
 * @param {string[]} files 绝对路径
 * @param {{exif?: string, listFile?: string}} args
 */
export async function readExif(files, args = {}) {
  if (args.exif) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const saved = JSON.parse(await fs.readFile(path.resolve(args.exif), 'utf8'));
    const byName = new Map(saved.map((t) => [path.basename(t.SourceFile || t.file || ''), t]));
    const out = files.map((f) => byName.get(path.basename(f)) || {});
    const missing = files.filter((f) => !byName.has(path.basename(f)));
    if (missing.length) {
      console.warn(`注意：${missing.length} 张在 EXIF 文件里找不到，将按「无拍摄时间」跳过。`);
    }
    return out;
  }

  if (USE_EXIFTOOL) {
    try {
      return await readViaExiftool(files);
    } catch (e) {
      console.warn('exiftool 读不了（' + e.message + '），改用内置解析。');
    }
  }

  const out = [];
  for (const f of files) out.push(await readOne(f));
  return out;
}