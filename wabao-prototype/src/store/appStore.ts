import { create } from "zustand";
import type { Assistant, ChatMessage, Conversation, Creation, ModelId } from "../lib/types";
import { api, tokens } from "../lib/api";

let seq = 100;
const uid = (p: string) => `${p}_${++seq}`;

interface AppState {
  booting: boolean;
  loggedIn: boolean;
  userName: string;
  userEmail: string;

  conversations: Conversation[];
  activeConversationId: string | null;
  loadedConversationIds: Set<string>;

  assistants: Assistant[];
  creations: Creation[];

  bootstrap: () => Promise<void>;
  afterAuth: (me: { email: string; name: string }) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;

  openConversation: (id: string | null) => Promise<void>;
  setActiveConversation: (id: string | null) => void;
  createConversation: () => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setConversationModel: (id: string, model: ModelId) => Promise<void>;
  setConversationAssistant: (id: string, assistantId: string) => Promise<void>;

  addMessage: (conversationId: string, msg: ChatMessage) => void;
  updateMessage: (conversationId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  replaceMessageId: (conversationId: string, oldId: string, newId: string) => void;
  removeMessage: (conversationId: string, msgId: string) => void;
  rateMessage: (conversationId: string, msgId: string, rating: "up" | "down") => void;

  loadAssistants: () => Promise<void>;
  upsertAssistant: (a: Assistant) => Promise<void>;
  deleteAssistant: (id: string) => Promise<void>;

  loadCreations: () => Promise<void>;
  addCreation: (c: Creation) => void;
}

export const useApp = create<AppState>((set, get) => ({
  booting: true,
  loggedIn: false,
  userName: "",
  userEmail: "",

  conversations: [],
  activeConversationId: null,
  loadedConversationIds: new Set(),

  assistants: [],
  creations: [],

  bootstrap: async () => {
    if (!tokens.access) {
      set({ booting: false, loggedIn: false });
      return;
    }
    try {
      const me = await api.users.me();
      await get().afterAuth(me);
    } catch {
      tokens.clear();
      set({ booting: false, loggedIn: false });
    }
  },

  // 内部：登录后加载初始数据
  afterAuth: async (me: { email: string; name: string }) => {
    const [conversations, assistants] = await Promise.all([
      api.conversations.list(),
      api.assistants.list(),
    ]);
    set({
      booting: false,
      loggedIn: true,
      userEmail: me.email,
      userName: me.name,
      conversations,
      assistants,
      activeConversationId: conversations[0]?.id ?? null,
      loadedConversationIds: new Set(),
    });
    if (conversations[0]) {
      await get().openConversation(conversations[0].id);
    }
  },

  login: async (email, password) => {
    const res = await api.auth.login(email, password);
    await get().afterAuth(res.user);
  },

  register: async (email, password, name) => {
    const res = await api.auth.register(email, password, name);
    await get().afterAuth(res.user);
  },

  logout: async () => {
    await api.auth.logout();
    set({
      loggedIn: false,
      userName: "",
      userEmail: "",
      conversations: [],
      assistants: [],
      creations: [],
      activeConversationId: null,
      loadedConversationIds: new Set(),
    });
  },

  setActiveConversation: (id) => set({ activeConversationId: id }),

  openConversation: async (id) => {
    set({ activeConversationId: id });
    if (!id || get().loadedConversationIds.has(id)) return;
    try {
      const full = await api.conversations.get(id);
      set((s) => ({
        conversations: s.conversations.map((c) => (c.id === id ? { ...c, messages: full.messages } : c)),
        loadedConversationIds: new Set(s.loadedConversationIds).add(id),
      }));
    } catch {
      /* ignore */
    }
  },

  createConversation: async () => {
    const conv = await api.conversations.create({ model: "gpt-5.6-terra" });
    set((s) => ({
      conversations: [conv, ...s.conversations],
      activeConversationId: conv.id,
      loadedConversationIds: new Set(s.loadedConversationIds).add(conv.id),
    }));
    return conv.id;
  },

  deleteConversation: async (id) => {
    await api.conversations.remove(id);
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      const activeConversationId =
        s.activeConversationId === id ? conversations[0]?.id ?? null : s.activeConversationId;
      return { conversations, activeConversationId };
    });
    const next = get().activeConversationId;
    if (next) await get().openConversation(next);
  },

  renameConversation: async (id, title) => {
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)) }));
    await api.conversations.update(id, { title }).catch(() => undefined);
  },

  togglePin: async (id) => {
    const conv = get().conversations.find((c) => c.id === id);
    const pinned = !conv?.pinned;
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, pinned } : c)) }));
    await api.conversations.update(id, { pinned }).catch(() => undefined);
  },

  setConversationModel: async (id, model) => {
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, model } : c)) }));
    await api.conversations.update(id, { model }).catch(() => undefined);
  },

  setConversationAssistant: async (id, assistantId) => {
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, assistantId } : c)),
    }));
    await api.conversations.update(id, { assistant_id: assistantId }).catch(() => undefined);
  },

  addMessage: (conversationId, msg) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: [...c.messages, msg],
              updatedAt: Date.now(),
              title:
                c.messages.filter((m) => m.role === "user").length === 0 && msg.role === "user"
                  ? msg.content.slice(0, 18)
                  : c.title,
            }
          : c,
      ),
    })),

  updateMessage: (conversationId, msgId, patch) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)) }
          : c,
      ),
    })),

  replaceMessageId: (conversationId, oldId, newId) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, messages: c.messages.map((m) => (m.id === oldId ? { ...m, id: newId } : m)) }
          : c,
      ),
    })),

  removeMessage: (conversationId, msgId) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, messages: c.messages.filter((m) => m.id !== msgId) } : c,
      ),
    })),

  rateMessage: (conversationId, msgId, rating) => {
    get().updateMessage(conversationId, msgId, { rating });
    api.messages.feedback(msgId, rating).catch(() => undefined);
  },

  loadAssistants: async () => {
    const assistants = await api.assistants.list();
    set({ assistants });
  },

  upsertAssistant: async (a) => {
    const exists = get().assistants.some((x) => x.id === a.id);
    if (exists) {
      const updated = await api.assistants.update(a.id, {
        name: a.name,
        system_prompt: a.systemPrompt,
        default_model: a.defaultModel,
        avatar: a.avatar,
      });
      set((s) => ({ assistants: s.assistants.map((x) => (x.id === a.id ? updated : x)) }));
    } else {
      const created = await api.assistants.create({
        name: a.name,
        system_prompt: a.systemPrompt,
        default_model: a.defaultModel,
        avatar: a.avatar,
      });
      set((s) => ({ assistants: [...s.assistants, created] }));
    }
  },

  deleteAssistant: async (id) => {
    await api.assistants.remove(id);
    set((s) => ({ assistants: s.assistants.filter((a) => a.id !== id) }));
  },

  loadCreations: async () => {
    const creations = await api.creations.list();
    set({ creations });
  },

  addCreation: (c) => set((s) => ({ creations: [c, ...s.creations] })),
}));

export const genId = uid;
