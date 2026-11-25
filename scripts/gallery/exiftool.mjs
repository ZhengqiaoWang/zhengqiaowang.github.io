/*
 * 可选的 exiftool 路线：读 node_modules 里自带的 exiftool.exe。
 * 部分 Windows 环境下 Node 起子进程会被安全软件拦掉（EPERM），所以这条路只是备选，
 * 默认不启用；想用就设 GALLERY_EXIFTOOL=1。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ARGS = ['-j', '-n', '-fast'];
const TIMEOUT_MS = 60000;

export function exiftoolBin() {
  const pkg = fileURLToPath(import.meta.resolve('exiftool-vendored.exe'));
  return path.join(path.dirname(pkg), 'bin', process.platform === 'win32' ? 'exiftool.exe' : 'exiftool');
}

export async function readExifTool(files) {
  const listFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.exif-list.txt');
  await fs.writeFile(listFile, files.join('\n'), 'utf8');
  try {
    const { stdout } = await Promise.race([
      execFileAsync(exiftoolBin(), [...ARGS, '-@', listFile], {
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('exiftool 超过 ' + TIMEOUT_MS / 1000 + ' 秒没有响应')), TIMEOUT_MS)
      ),
    ]);
    return JSON.parse(stdout || '[]');
  } finally {
    await fs.rm(listFile, { force: true });
  }
}