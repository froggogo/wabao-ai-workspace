import { Response } from 'express';

export interface SseEvent {
  event: string;
  data: unknown;
}

/** 初始化 SSE 响应头 */
export function initSse(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

/** 写入一条 SSE 事件 */
export function writeSse(res: Response, evt: SseEvent): void {
  res.write(`event: ${evt.event}\n`);
  res.write(`data: ${JSON.stringify(evt.data)}\n\n`);
}
