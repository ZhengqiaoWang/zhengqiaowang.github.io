/*
 * 图片盲水印 —— 页面逻辑。
 *
 * 全部在浏览器里跑：读文件 → WASM 里做 DWT-DCT-SVD → 生成新图。
 * 一次只处理一张（WASM 实例是单例，并行没有意义），进度写在 #progress。
 */

import BlindWatermark from './vendor/blind-watermark/index.browser.mjs';
import { makeZip, capacityBytes, MAX_PIXELS, utf8Len, formatBytes, outputName } from './wm-core.js';

/* ---------------- 元素 ---------------- */

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const fileNote = document.getElementById('fileNote');
const wmText = document.getElementById('wmText');
const textCount = document.getElementById('textCount');
const wmFormat = document.getElementById('wmFormat');
const runBtn = document.getElementById('runBtn');
const zipBtn = document.getElementById('zipBtn');
const clearBtn = document.getElementById('clearBtn');
const progress = document.getElementById('progress');
const writePane = document.getElementById('writePane');
const readPane = document.getElementById('readPane');

const bwm = new BlindWatermark();

/* ---------------- 状态 ---------------- */

/** @type {{id:number,file:File,name:string,size:number,thumb:string,dims:string,status:string,tone:string,out:Blob|null,outName:string,text:string,error:string}[]} */
const items = [];
let nextId = 1;
let running = false;

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

function mode() {
    const checked = document.querySelector('input[name="mode"]:checked');
    return checked ? checked.value : 'write';
}

/* ---------------- 渲染 ---------------- */

function icon(name) {
    if (name === 'x') {
        return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    }
    if (name === 'download') {
        return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7.5 10.5L12 15l4.5-4.5M4 20h16"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
}

function render() {
    if (!items.length) {
        fileList.hidden = true;
        fileList.innerHTML = '';
        fileNote.textContent = '还没有选';
        runBtn.disabled = true;
        zipBtn.hidden = true;
        clearBtn.hidden = true;
        return;
    }

    fileList.hidden = false;
    fileNote.textContent = '共 ' + items.length + ' 张';

    const isWrite = mode() === 'write';
    fileList.innerHTML = items.map(item => {
        const tone = item.tone === 'ok' ? ' is-ok' : item.tone === 'bad' ? ' is-bad' : '';
        const meta = item.status + (item.dims ? ' · ' + item.dims : '');
        const out = item.text && mode() === 'read'
            ? '<span class="file__out">「' + escapeHtml(item.text) + '」</span>'
            : '';
        const err = item.error
            ? (item.tone === 'bad'
                ? '<span class="file__err" title="' + escapeHtml(item.rawError || item.error) + '">失败原因：' + escapeHtml(item.error) + '</span>'
                : '<span class="file__err file__err--note">' + escapeHtml(item.error) + '</span>')
            : '';
        const acts = [];
        if (item.out && isWrite) {
            acts.push('<button class="icon-btn" type="button" data-act="save" data-id="' + item.id + '" aria-label="下载这张" title="下载">' + icon('download') + '</button>');
        }
        if (item.text && mode() === 'read') {
            acts.push('<button class="icon-btn" type="button" data-act="copy" data-id="' + item.id + '" aria-label="复制文字" title="复制">' + icon('copy') + '</button>');
        }
        acts.push('<button class="icon-btn" type="button" data-act="remove" data-id="' + item.id + '" aria-label="移除这张" title="移除">' + icon('x') + '</button>');

        return '<li class="file">'
            + '<img class="file__thumb" src="' + item.thumb + '" alt="" loading="lazy">'
            + '<span class="file__body">'
            + '<span class="file__name">' + escapeHtml(item.name) + '</span>'
            + '<span class="file__meta' + tone + '">' + escapeHtml(meta) + '</span>'
            + out
            + err
            + '</span>'
            + '<span class="file__act">' + acts.join('') + '</span>'
            + '</li>';
    }).join('');

    clearBtn.hidden = false;
    zipBtn.hidden = true; // 处理完再显示
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function updateRunBtn() {
    if (running) return;
    const has = items.length > 0;
    if (mode() === 'write') {
        runBtn.disabled = !has || !wmText.value.trim();
    } else {
        runBtn.disabled = !has;
    }
}

/* ---------------- 加文件 ---------------- */

function addFiles(fileListLike) {
    const incoming = Array.from(fileListLike).filter(file => /^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name));
    if (!incoming.length) {
        progress.textContent = '没有认出图片文件';
        return;
    }

    const known = new Set(items.map(item => item.name + '|' + item.size));
    for (const file of incoming) {
        const key = file.name + '|' + file.size;
        if (known.has(key)) continue;
        known.add(key);
        const item = {
            id: nextId++,
            file,
            name: file.name,
            size: file.size,
            thumb: URL.createObjectURL(file),
            dims: '',
            status: formatBytes(file.size) + ' · 待处理',
            tone: '',
            out: null,
            outName: '',
            text: '',
            error: ''
        };
        items.push(item);
        probe(item);
    }
    render();
    updateRunBtn();
}

async function probe(item) {
    try {
        const bitmap = await createImageBitmap(item.file);
        item.dims = bitmap.width + '×' + bitmap.height;
        item.width = bitmap.width;
        item.height = bitmap.height;
        bitmap.close();

        const big = item.width * item.height > MAX_PIXELS;
        const target = scaledDims(item.width, item.height);
        const room = capacityBytes(target.w, target.h);
        const need = utf8Len(wmText.value);

        if (mode() === 'write' && need > room) {
            item.status = formatBytes(item.size) + ' · 太小，放不下这段文字';
            item.tone = 'bad';
        } else if (big) {
            item.status = formatBytes(item.size) + ' · 太大，写入前会缩到 ' + target.w + '×' + target.h;
        } else {
            item.status = formatBytes(item.size) + ' · 待处理';
        }
    } catch (e) {
        item.status = formatBytes(item.size) + ' · 读不出尺寸';
        item.tone = 'bad';
    }
    render();
    updateRunBtn();
}

/** 超过 1000 万像素的图，按比例缩到 900 万（留出让 wasm 喘气的余量）。 */
const SCALE_TO = 9000000;

function scaledDims(width, height) {
    if (!width || !height || width * height <= MAX_PIXELS) return { w: width, h: height };
    const scale = Math.sqrt(SCALE_TO / (width * height));
    return { w: Math.max(1, Math.floor(width * scale)), h: Math.max(1, Math.floor(height * scale)) };
}

/* ---------------- 处理 ---------------- */

async function run() {
    if (running || !items.length) return;
    running = true;
    runBtn.disabled = true;
    zipBtn.hidden = true;
    progress.textContent = '准备中…';
    fileList.setAttribute('aria-busy', 'true');

    const isWrite = mode() === 'write';
    const text = wmText.value.trim();
    const format = wmFormat.value;
    const ext = format === 'jpg' ? 'jpg' : format;

    let done = 0;
    let failed = 0;

    for (const item of items) {
        done++;
        progress.textContent = '处理中 ' + done + ' / ' + items.length;
        await frame();

        if (!isWrite && item.text) { continue; } // 已经读过的跳过

        try {
            let bytes = new Uint8Array(await item.file.arrayBuffer());
            let scaleNote = '';

            if (isWrite) {
                const target = scaledDims(item.width, item.height);
                if (item.width && item.height && (target.w !== item.width || target.h !== item.height)) {
                    bytes = await downscale(item.file, target.w, target.h);
                    scaleNote = ' · 已缩到 ' + target.w + '×' + target.h;
                }
                const room = capacityBytes(target.w, target.h);
                if (utf8Len(text) > room) {
                    throw new Error('这张图最多放 ' + room + ' 字节，这段文字有 ' + utf8Len(text) + ' 字节 —— 换张更大的图，或者把字写短一点');
                }
                const out = await bwm.embed(bytes, text, ext);
                const blob = new Blob([out], { type: MIME[ext] || 'image/png' });
                if (item.outUrl) URL.revokeObjectURL(item.outUrl);
                item.out = blob;
                item.outName = outputName(item.name, ext);
                item.outUrl = URL.createObjectURL(blob);
                item.status = formatBytes(item.size) + ' → ' + formatBytes(blob.size) + ' · 已写入' + scaleNote;
                item.tone = 'ok';
                item.error = '';
            } else {
                // 没有水印的图，wasm 内部会因为读不出长度而 abort —— 这是「没读到」，不是「处理失败」。
                let result = null;
                try {
                    result = await bwm.extract(bytes);
                } catch (e) {
                    if (!isAbort(e)) throw e;
                    result = null;
                }
                if (!result || !result.found) {
                    item.text = '';
                    item.status = formatBytes(item.size) + ' · 没有读到水印';
                    item.tone = '';
                    item.rawError = '';
                    item.error = '这张图里没有可读的水印（也可能是被缩放过、重新压缩过，那种情况下水印已经毁掉）';
                } else {
                    const shown = result.text !== undefined ? result.text : '（二进制 ' + result.bytes.length + ' 字节）';
                    item.text = shown;
                    item.status = formatBytes(item.size) + (result.valid ? ' · 读到，校验通过' : ' · 读到，校验未通过');
                    item.tone = result.valid ? 'ok' : 'bad';
                    item.rawError = '';
                    item.error = '';
                }
            }
        } catch (e) {
            failed++;
            item.tone = 'bad';
            item.status = formatBytes(item.size) + ' · 失败';
            item.rawError = (e && e.message) || String(e);
            item.error = friendlyError(e);
            item.text = '';
            item.out = null;
        }
        render();
        await frame();
    }

    fileList.removeAttribute('aria-busy');
    running = false;
    updateRunBtn();

    const okCount = items.filter(item => item.tone === 'ok').length;
    progress.textContent = isWrite
        ? '完成：' + okCount + ' 张已写入' + (failed ? '，' + failed + ' 张失败' : '')
        : '完成：' + okCount + ' 张读到水印' + (failed ? '，' + failed + ' 张没读出来' : '');

    if (isWrite) {
        zipBtn.hidden = items.every(item => !item.out);
    }
}

function isAbort(error) {
    const message = (error && error.message) || String(error);
    return /Aborted/i.test(message);
}

function friendlyError(error) {
    const message = (error && error.message) || String(error);
    if (/Aborted/i.test(message)) return '这张图的空间不够写这段文字（图太小或字太长）';
    if (/decode|invalid|not a valid|unsupported/i.test(message)) return '这个文件打不开，可能是浏览器不认的格式（比如 AVIF / HEIC）';
    if (/large|pixel|memory/i.test(message)) return '图太大，浏览器内存不够了，换张小一点的';
    return message;
}

/** 大图先缩到 900 万像素以内，中间格式用 PNG，避免多压一次。 */
async function downscale(file, width, height) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('缩小图片失败，这张图的尺寸可能过大');
    return new Uint8Array(await blob.arrayBuffer());
}

function frame() {
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

/* ---------------- 下载 ---------------- */

function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function stamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
}

async function downloadZip() {
    const ready = items.filter(item => item.out);
    if (!ready.length) return;
    progress.textContent = '打包中…';
    await frame();
    const files = await Promise.all(ready.map(async item => ({
        name: item.outName,
        data: new Uint8Array(await item.out.arrayBuffer())
    })));
    const zip = makeZip(files);
    download(new Blob([zip], { type: 'application/zip' }), 'watermarked-' + stamp() + '.zip');
    progress.textContent = '已打包 ' + files.length + ' 张';
}

/* ---------------- 事件 ---------------- */

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length) addFiles(fileInput.files);
    fileInput.value = '';
});

['dragenter', 'dragover'].forEach(type => {
    dropZone.addEventListener(type, event => {
        event.preventDefault();
        dropZone.classList.add('is-over');
    });
});

['dragleave', 'drop'].forEach(type => {
    dropZone.addEventListener(type, event => {
        event.preventDefault();
        dropZone.classList.remove('is-over');
    });
});

dropZone.addEventListener('drop', event => {
    const dropped = event.dataTransfer && event.dataTransfer.files;
    if (dropped && dropped.length) addFiles(dropped);
});

fileList.addEventListener('click', event => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const item = items.find(entry => String(entry.id) === button.dataset.id);
    if (!item) return;

    if (button.dataset.act === 'remove') {
        removeItem(item);
    } else if (button.dataset.act === 'save' && item.out) {
        download(item.out, item.outName);
    } else if (button.dataset.act === 'copy') {
        const text = (item.text || '').replace(/^「|」$/g, '');
        if (navigator.clipboard && text) {
            navigator.clipboard.writeText(text).then(
                () => { progress.textContent = '已复制'; },
                () => { progress.textContent = '复制失败，请手动选中'; }
            );
        }
    }
});

function removeItem(item) {
    if (item.thumb) URL.revokeObjectURL(item.thumb);
    if (item.outUrl) URL.revokeObjectURL(item.outUrl);
    const index = items.indexOf(item);
    if (index >= 0) items.splice(index, 1);
    render();
    updateRunBtn();
}

document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
        const isWrite = mode() === 'write';
        writePane.hidden = !isWrite;
        readPane.hidden = isWrite;
        progress.textContent = '';
        items.forEach(item => {
            item.text = '';
            item.out = null;
            item.outName = '';
            if (item.outUrl) {
                URL.revokeObjectURL(item.outUrl);
                item.outUrl = '';
            }
            item.tone = '';
            item.status = formatBytes(item.size) + ' · 待处理';
        });
        render();
        updateRunBtn();
    });
});

wmText.addEventListener('input', () => {
    textCount.textContent = String(Array.from(wmText.value).length);
    updateRunBtn();
});

runBtn.addEventListener('click', run);
zipBtn.addEventListener('click', downloadZip);

clearBtn.addEventListener('click', () => {
    items.slice().forEach(removeItem);
    progress.textContent = '';
    zipBtn.hidden = true;
});

/* 初始状态 */
render();
updateRunBtn();

/* 给页面一个「模块已经在跑了」的标记，外层用它判断要不要提示加载失败 */
document.documentElement.dataset.wmReady = '1';
