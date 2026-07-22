import { Injectable } from '@nestjs/common';
import { DEFAULT_MODEL, isValidModel, ModelId } from './models';

/**
 * 模型路由（M10 雏形）：校验请求模型，非法则兜底为 Terra。
 * 后续可按任务复杂度/成本接入 RoutingRule。
 */
@Injectable()
export class RouterService {
  resolve(requested?: string): ModelId {
    if (requested && isValidModel(requested)) {
      return requested;
    }
    return DEFAULT_MODEL;
  }
}
