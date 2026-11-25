#!/usr/bin/env node
/*
 * 图库发布脚本：原片 → 压缩 → 盲水印 → 缩略图 → photos.json
 *
 * 用法（在仓库根目录）：
 *   node scripts/gallery/build.mjs "D:/相册/2025国庆" --tags 雪山,湖泊
 *   node scripts/gallery/build.mjs "D:/相册/2025国庆" --tags 雪山 --tag 阿坝州
 *
 * 可选参数：
 *   --tags a,b,c    本次所有照片共用的标签（可重复 --tag）
 *   --out <dir>     图片输出目录，默认 assets/gallery
 *   --data <file>   数据文件，默认 assets/gallery/photos.json
 *   --quality <n>   预压缩质量，默认 85
 *   --width <n>     长边上限，默认 1600
 *   --watermark <s> 水印文本，默认 www.zhengqiao.wang
 *   --shift <n>     相机时钟偏移小时数（相机是 UTC 就填 8）
 *   --city <名称>   强制指定本次所有照片的城市，跳过逆地理
 *   --dry           只跑压缩和水印，不写文件（用来看体积和速度）
 *   --force         已存在的图片也重新生成
 *
 * 关键约束：水印必须写在最终尺寸的图上，写完之后不能再缩放/裁剪/重编码，
 * 否则水印会被破坏。所以顺序固定为「压缩 → 写水印 → 原样导出」。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import {
  ROOT, processPhoto, makeRecord, fileNameFor,
  readExif, listSources, readState, writeState, pad, kb, slug,
} from './lib.mjs';

/* ---------------- 参数 ---------------- */

function parseArgs(argv) {
  const out = { tags: [], out: 'assets/gallery', data: 'assets/gallery/photos.json', quality: 85, width: 1600, watermark: 'www.zhengqiao.wang', shift: 0, dry: false, force: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--tags') out.tags.push(...String(next()).split(/[,，、]/).map((s) => s.trim()).filter(Boolean));
    else if (a === '--tag') out.tags.push(...String(next()).split(/[,，、]/).map((s) => s.trim()).filter(Boolean));
    else if (a === '--out') out.out = next();
    else if (a === '--data') out.data = next();
    else if (a === '--quality') out.quality = Number(next());
    else if (a === '--width') out.width = Number(next());
    else if (a === '--watermark') out.watermark = next();
    else if (a === '--shift') out.shift = Number(next());
    else if (a === '--city') out.city = next();
    else if (a === '--title') out.title = next();
    else if (a === '--dry') out.dry = true;
    else if (a === '--force') out.force = true;
    else if (a === '--exif') out.exif = next();
    else if (a === '--album') out.album = next();
    else if (a === '--help' || a === '-h') out.help = true;
    else rest.push(a);
  }
  out.src = rest[0];
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.src) {
  console.log(`图库发布脚本

  node scripts/gallery/build.mjs <照片目录或单个文件> [选项]

  --tags a,b,c     所有照片共用的标签
  --tag a          同上，可重复
  --out <dir>      图片输出目录（默认 assets/gallery）
  --data <file>    数据文件（默认 assets/gallery/photos.json）
  --quality <n>    预压缩质量（默认 85）
  --width <n>      长边上限（默认 1600）
  --watermark <s>  水印文本（默认 www.zhengqiao.wang）
  --shift <n>      相机时钟偏移小时（相机是 UTC 就填 8）
  --city <名称>    强制指定城市，跳过逆地理
  --dry            不写文件，只测体积和耗时
  --force          已存在的图片也重新生成
  --exif <file>    用已有的 exiftool JSON 代替现读（离线/受限环境用）
  --title <名称>   作品名（比如「三星堆黄金面具」），网格和灯箱都会显示；不填就用「城市 · 日期」
  --album <名称>   相册名，会成为 photos.json 里的 collection 字段`);
  process.exit(args.help ? 0 : 1);
}

const SRC = path.resolve(args.src);
const OUT_DIR = path.resolve(ROOT, args.out);
const DATA_FILE = path.resolve(ROOT, args.data);

async function main() {
  const files = await listSources(SRC);
  if (!files.length) {
    console.error(`没有在 ${SRC} 找到图片。`);
    process.exit(1);
  }

  console.log(`\n照片 ${files.length} 张\n原片目录 ${SRC}\n图片输出 ${path.relative(ROOT, OUT_DIR)}\n`);

  await fs.mkdir(OUT_DIR, { recursive: true });

  // 已有数据
  let store = { photos: [] };
  if (existsSync(DATA_FILE)) {
    try {
      store = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
      if (!Array.isArray(store.photos)) store.photos = [];
    } catch {
      console.warn('已有的 photos.json 读不出来，将另存备份后重建。');
      await fs.copyFile(DATA_FILE, DATA_FILE + '.bak');
      store = { photos: [] };
    }
  }
  const known = new Map(store.photos.map((p) => [p.id, p]));
  const usedIds = new Set(known.keys());
  const usedThisRun = new Set();

  const state = await readState();
  const noGps = [];

  console.log('读 EXIF…');
  const metas = await readExif(files, args);

  const TEXT = args.watermark;

  let added = 0;
  let skipped = 0;
  let totalBytes = 0;
  let thumbBytes = 0;
  let failed = 0;

  for (const [i, file] of files.entries()) {
    const name = path.basename(file);
    const t0 = Date.now();
    const raw = await fs.readFile(file);
    const sha = createHash('sha256').update(raw).digest('hex');
    const meta = metas[i] || {};

    try {
      // 1) 元数据：时间、城市、相机、镜头 —— 和本地网页上传走同一个函数
      const rec = makeRecord(meta, {
        tags: args.tags, album: args.album, city: args.city, shift: args.shift, title: args.title,
      });
      const base = `${rec.date}-${slug(rec.city) || 'photo'}`;

      let seq = 1;
      let id = `${base}-${pad(seq)}`;
      // 同一张原片重新跑：沿用原 id。否则占位到下一个空号
      const sameShot = store.photos.find((p) => p.source === sha || state.photos[p.id]?.sha === sha);
      if (sameShot) {
        id = sameShot.id;
      } else {
        while (known.has(id) || usedThisRun.has(id)) {
          seq++;
          id = `${base}-${pad(seq)}`;
        }
      }
      usedThisRun.add(id);
      if (sameShot && existsSync(path.join(OUT_DIR, `${id}.jpg`)) && !args.force) {
        skipped++;
        continue;
      }

      // 2) 压缩 → 水印 → 读回校验 → 缩略图（顺序是硬约束）
      const still = await processPhoto(raw, {
        width: args.width, quality: args.quality, watermark: TEXT,
      });

      if (rec.city === '待定' && !args.city) noGps.push(id);

      const record = {
        id,
        src: `assets/gallery/${id}.jpg`,
        thumb: `assets/gallery/${id}-t.webp`,
        w: still.w,
        h: still.h,
        ...rec,
        source: sha,
      };

      if (!args.dry) {
        await fs.writeFile(path.join(OUT_DIR, `${id}.jpg`), still.jpg);
        await fs.writeFile(path.join(OUT_DIR, `${id}-t.webp`), still.thumb);
        known.set(id, record);
      }

      state.photos[id] = { sha, file: name, createdAt: new Date().toISOString() };
      added++;
      totalBytes += still.jpg.length;
      thumbBytes += still.thumb.length;

      console.log(
        `${name.slice(0, 26).padEnd(28)} ${`${still.w}x${still.h}`.padEnd(10)} ` +
        `${kb(raw.length).padStart(7)} → ${kb(still.jpg.length).padStart(6)} + 缩略图 ${kb(still.thumb.length).padStart(5)}  ` +
        `✓ ${id}  ${Date.now() - t0}ms`,
      );
    } catch (err) {
      failed++;
      console.warn(`${name.slice(0, 26).padEnd(28)} ✗ ${err.message}`);
    }
  }

  if (!args.dry) {
    store.photos = [...known.values()].sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
    store.generatedAt = new Date().toISOString();
    // 水印口径写进 JSON，页面上要用
    store.watermark = TEXT;
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2) + '\n');
    await writeState(state);
  }

  console.log(
    `\n完成：新增 ${added}，跳过 ${skipped}（已在库里），失败 ${failed}\n` +
    `正片 ${(totalBytes / 1024 / 1024).toFixed(1)}MB，缩略图 ${(thumbBytes / 1024 / 1024).toFixed(1)}MB\n` +
    (args.dry ? '（--dry，没有写任何文件）\n' : `数据已写入 ${path.relative(ROOT, DATA_FILE)}\n`),
  );

  if (noGps.length) {
    console.log(
      `有 ${noGps.length} 张没有 GPS，城市先写成「待定」；\n` +
      `直接改 ${path.relative(ROOT, DATA_FILE)} 里的 city 字段即可，不用重跑。\n` +
      `示例：${noGps.slice(0, 5).join('、')}${noGps.length > 5 ? ' …' : ''}\n`,
    );
  }
  if (args.shift === 0) {
    console.log('提示：相机时钟若是 UTC（常见于把时区设成 UTC 的机器），用 --shift 8 校正成北京时间。\n');
  }

  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});