import { Global, Injectable, Module } from '@nestjs/common';

/**
 * 进行中的生成任务注册表（按 messageId 索引 AbortController）。
 * 用于支持 POST /messages/:id/stop 主动停止（P1 单实例内存实现）。
 */
@Injectable()
export class AbortRegistry {
  private readonly map = new Map<string, AbortController>();

  create(id: string): AbortController {
    const controller = new AbortController();
    this.map.set(id, controller);
    return controller;
  }

  abort(id: string): boolean {
    const controller = this.map.get(id);
    if (!controller) return false;
    controller.abort();
    this.map.delete(id);
    return true;
  }

  clear(id: string): void {
    this.map.delete(id);
  }
}

@Global()
@Module({
  providers: [AbortRegistry],
  exports: [AbortRegistry],
})
export class AbortRegistryModule {}
