#!/usr/bin/env node
/**
 * 一键初始化脚本（跨平台）：
 *   1. 复制 .env.example -> .env（前后端，若不存在）
 *   2. 安装前后端依赖
 *   3. 尝试起数据库(Docker) + 建表 + 注入模板；Docker 不可用时给出提示，不报错中断
 *
 * 用法：pnpm setup   （或 npm run setup）
 */
import { execSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'apps', 'api');
const web = join(root, 'apps', 'web');

const log = (m) => console.log(`\n\x1b[36m▶ ${m}\x1b[0m`);
const ok = (m) => console.log(`\x1b[32m✓ ${m}\x1b[0m`);
const warn = (m) => console.log(`\x1b[33m! ${m}\x1b[0m`);

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}
function tryRun(cmd, cwd) {
  try {
    run(cmd, cwd);
    return true;
  } catch {
    return false;
  }
}
function ensureEnv(dir) {
  const env = join(dir, '.env');
  const example = join(dir, '.env.example');
  if (!existsSync(env) && existsSync(example)) {
    copyFileSync(example, env);
    ok(`已生成 ${env}（复制自 .env.example）`);
  } else if (existsSync(env)) {
    ok(`${env} 已存在，跳过`);
  }
}

console.log('\x1b[1m🐸 蛙宝 AI 工作台 · 一键初始化\x1b[0m');

// 1. 环境变量
log('准备环境变量 .env');
ensureEnv(api);
ensureEnv(web);

// 2. 安装依赖（pnpm workspace：根目录一次性安装全部子项目）
log('安装 workspace 依赖（根目录，含 apps/* · packages/* · wabao-prototype）');
run('pnpm install', root);
log('构建共享契约包（packages/shared）');
run('pnpm --dir packages/shared build', root);

// 3. 数据库（Docker 可选）
log('检查 Docker 是否可用');
const dockerReady = tryRun('docker info', api);
if (dockerReady) {
  log('启动数据库容器（PostgreSQL + Redis）');
  run('docker compose up -d', api);

  log('等待数据库就绪');
  let pgUp = false;
  for (let i = 0; i < 30; i++) {
    if (tryRun('docker exec wabao-postgres pg_isready -U wabao', api)) {
      pgUp = true;
      break;
    }
    execSync(process.platform === 'win32' ? 'timeout /t 2 /nobreak >nul' : 'sleep 2', {
      shell: true,
    });
  }
  if (pgUp) {
    log('生成 Prisma Client');
    run('pnpm prisma:generate', api);
    log('建表（prisma db push）');
    run('pnpm prisma:push', api);
    log('注入模板（seed）');
    run('pnpm seed', api);
    ok('数据库已就绪并完成初始化');
  } else {
    warn('数据库启动超时，请稍后手动执行：pnpm --dir apps/api prisma:push && pnpm --dir apps/api seed');
  }
} else {
  warn('未检测到可用的 Docker（引擎未启动或未安装）。');
  warn('请启动 Docker Desktop 后执行：pnpm db:up && pnpm db:init');
  warn('或改用云/原生 PostgreSQL：修改 apps/api/.env 的 DATABASE_URL 后执行 pnpm db:init');
}

console.log('\n\x1b[1m✅ 初始化完成。下一步：\x1b[0m');
console.log('  1) 启动后端： \x1b[36mpnpm dev:api\x1b[0m   -> http://localhost:3001/api/v1');
console.log('  2) 启动前端： \x1b[36mpnpm dev:web\x1b[0m   -> http://localhost:5173');
console.log('  3) 浏览器打开 http://localhost:5173 注册并开始使用\n');
