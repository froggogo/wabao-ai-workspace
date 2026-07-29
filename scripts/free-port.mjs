#!/usr/bin/env node
/**
 * 端口检测与释放（跨平台）：
 *   启动前先检查指定端口是否被占用，若被占用则结束对应进程并释放端口。
 *
 * 用法：
 *   node scripts/free-port.mjs 3001
 *   node scripts/free-port.mjs 5173 5174
 *
 * 已内置于 pnpm dev:api / dev:web，正常无需手动调用。
 */
import { execSync } from 'node:child_process';

const log = (m) => console.log(`\x1b[36m▶ ${m}\x1b[0m`);
const ok = (m) => console.log(`\x1b[32m✓ ${m}\x1b[0m`);
const warn = (m) => console.log(`\x1b[33m! ${m}\x1b[0m`);

const isWin = process.platform === 'win32';

/** 查询占用指定端口（LISTEN）的进程 PID 列表 */
function findPids(port) {
  const pids = new Set();
  try {
    if (isWin) {
      // netstat 输出：协议 本地地址 外部地址 状态 PID
      const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        // 匹配 :端口 且前面是地址边界，避免 51730 匹配到 173
        if (!new RegExp(`[:.]${port}\\s`).test(line)) continue;
        const cols = line.trim().split(/\s+/);
        const pid = cols[cols.length - 1];
        if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
    } else {
      const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: 'utf8' });
      for (const pid of out.split(/\r?\n/)) {
        if (/^\d+$/.test(pid.trim())) pids.add(pid.trim());
      }
    }
  } catch {
    // netstat/lsof 无匹配时会非零退出，视为端口空闲
  }
  return [...pids];
}

function kill(pid) {
  try {
    if (isWin) execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    else execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ports = process.argv.slice(2).filter((p) => /^\d+$/.test(p));
if (ports.length === 0) {
  warn('未指定端口，用法：node scripts/free-port.mjs <port> [port...]');
  process.exit(0);
}

for (const port of ports) {
  const pids = findPids(port);
  if (pids.length === 0) {
    ok(`端口 ${port} 空闲`);
    continue;
  }
  log(`端口 ${port} 被占用（PID: ${pids.join(', ')}），正在释放…`);
  for (const pid of pids) {
    if (kill(pid)) ok(`已结束进程 ${pid}，释放端口 ${port}`);
    else warn(`无法结束进程 ${pid}（可能需要管理员权限或已退出）`);
  }
}
