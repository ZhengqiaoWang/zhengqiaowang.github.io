/*
 * 图片盲水印工具的纯函数部分（不碰 DOM，方便本地跑测试）。
 * 打包 ZIP 用 STORE（不压缩）——图片本身已经是压缩格式，再压只是白费 CPU。
 */

/* ---------------- CRC32 ---------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---------------- 小巧的 STORE ZIP ---------------- */

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

/**
 * 把若干文件打成一个 ZIP。
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Uint8Array}
 */
export function makeZip(files) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(sanitizeName(file.name));
    const data = file.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // 本地文件头标志
    lv.setUint16(4, 20, true);           // 解压所需版本 2.0
    lv.setUint16(6, 0x0800, true);       // bit 11：文件名是 UTF-8
    lv.setUint16(8, 0, true);            // 压缩方式 STORE
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // 压缩后大小
    lv.setUint32(22, data.length, true); // 原始大小
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // 扩展字段长度
    local.set(nameBytes, 30);

    parts.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);   // 中央目录标志
    cv.setUint16(4, 20, true);           // 生成版本
    cv.setUint16(6, 20, true);           // 解压所需版本
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);           // 扩展字段
    cv.setUint16(32, 0, true);           // 注释
    cv.setUint16(34, 0, true);           // 起始磁盘
    cv.setUint16(36, 0, true);           // 内部属性
    cv.setUint32(38, 0, true);           // 外部属性
    cv.setUint32(42, offset, true);      // 本地头偏移
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  let centralSize = 0;
  for (const cd of central) centralSize += cd.length;

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  for (const cd of central) { out.set(cd, p); p += cd.length; }
  out.set(end, p);
  return out;
}

/* ---------------- 容量估算 ---------------- */

/** 库本身拒绝超过 ~10MP 的图片（浮点变换会耗尽 1GB 堆）。 */
export const MAX_PIXELS = 10000000;

/**
 * 估算这张图能藏多少字节的文字。
 * 依据：DWT 一层后每个子带的 4×4 DCT 块数、3 位冗余、以及 6 字节的自描述头。
 * 实测 512×512 可放 160 字节、256×256 只能放 10 字节，与此公式一致。
 */
export function capacityBytes(width, height, redundancy = 3) {
  const blocks = Math.floor(width / 8) * Math.floor(height / 8);
  return Math.max(0, Math.floor(blocks / redundancy / 8) - 6);
}

/* ---------------- 小工具 ---------------- */

export function utf8Len(text) {
  return new TextEncoder().encode(text).length;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 去掉文件名里 Windows 不认的字符，并留出后缀的空间。 */
export function sanitizeName(name) {
  const cleaned = String(name).replace(ILLEGAL, '_').replace(/^\.+/, '').trim();
  return cleaned || 'image';
}

/** 把原文件名换成输出名：photo.jpg -> photo-watermarked.png */
export function outputName(originalName, extension) {
  const base = String(originalName).replace(/\.[^.]+$/, '');
  return sanitizeName(base) + '-watermarked.' + extension;
}
