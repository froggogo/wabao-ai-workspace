export type ModelId = "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna";

export type ReasoningEffort = "low" | "medium" | "high";

export interface ModelInfo {
  id: ModelId;
  name: string;
  desc: string;
}

export interface Assistant {
  id: string;
  name: string;
  avatar: string;
  systemPrompt: string;
  defaultModel: ModelId;
}

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  model?: ModelId;
  streaming?: boolean;
  flagged?: boolean;
  rating?: "up" | "down";
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: ModelId;
  assistantId: string;
  pinned: boolean;
  temperature: number;
  reasoningEffort: ReasoningEffort;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export type TemplateField =
  | { key: string; label: string; type: "text" | "textarea"; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: "select"; options: string[]; default?: string };

export interface Template {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  fields: TemplateField[];
  structured?: boolean;
}

export interface Creation {
  id: string;
  templateId: string;
  templateName: string;
  output: string;
  createdAt: number;
}

export interface UsageBreakdown {
  feature: string;
  label: string;
  calls: number;
  tokens: number;
}

export interface ModerationRecord {
  id: string;
  refType: "input" | "output";
  flagged: boolean;
  categories: string[];
  action: "block" | "warn";
  createdAt: number;
}
