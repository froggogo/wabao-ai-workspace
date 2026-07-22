import type { ModelInfo } from "./types";

// 模型列表为静态展示数据；其余业务数据（会话/助手/模板/用量）均来自后端 API
export const MODELS: ModelInfo[] = [
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", desc: "旗舰推理 · 复杂任务" },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", desc: "均衡 · 日常首选" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", desc: "高性价比 · 高并发" },
];
