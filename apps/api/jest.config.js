/** 单元测试配置（无需数据库） */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  // @wabao/shared 编译产物为 ESM，而本项目测试运行在 CommonJS 下，
  // 直接 require dist/index.js 会报 "Unexpected token 'export'"。
  // 这里映射到共享包的 TS 源码，交给 ts-jest 一并转译为 CJS，
  // 同时保证测试始终针对最新契约（无需先 build shared）。
  moduleNameMapper: {
    '^@wabao/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
  },
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!main.ts'],
};
