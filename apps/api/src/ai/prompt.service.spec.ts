import { PromptService } from './prompt.service';

describe('PromptService', () => {
  const prompt = new PromptService();

  describe('buildChatMessages', () => {
    it('首条为 system，末条为当前用户输入，历史顺序保留', () => {
      const turns = prompt.buildChatMessages({
        systemPrompt: '你是测试助手',
        history: [
          { role: 'user', content: '第一问' },
          { role: 'assistant', content: '第一答' },
        ],
        userContent: '第二问',
      });
      expect(turns[0]).toEqual({ role: 'system', content: '你是测试助手' });
      expect(turns[1].content).toBe('第一问');
      expect(turns[2].content).toBe('第一答');
      expect(turns[turns.length - 1]).toEqual({ role: 'user', content: '第二问' });
    });

    it('缺省 systemPrompt 时使用默认人设', () => {
      const turns = prompt.buildChatMessages({ systemPrompt: null, history: [], userContent: 'hi' });
      expect(turns[0].role).toBe('system');
      expect(turns[0].content.length).toBeGreaterThan(0);
    });
  });

  describe('buildCreationMessages', () => {
    it('普通模板：把字段拼进用户消息', () => {
      const turns = prompt.buildCreationMessages({
        templatePrompt: '你是周报助手',
        fields: [
          { key: 'done', label: '本周完成', type: 'textarea' },
          { key: 'plan', label: '下周计划', type: 'textarea' },
        ],
        inputs: { done: '完成A', plan: '' },
        structured: false,
      });
      expect(turns[0].content).toContain('周报助手');
      expect(turns[1].content).toContain('本周完成：完成A');
      expect(turns[1].content).toContain('下周计划：（未填写）');
    });

    it('结构化模板：system 中包含 JSON Schema 约束', () => {
      const schema = { type: 'object', properties: { name: { type: 'string' } } };
      const turns = prompt.buildCreationMessages({
        templatePrompt: '抽取信息',
        fields: [{ key: 'text', label: '原始文本', type: 'textarea' }],
        inputs: { text: '张三' },
        structured: true,
        outputSchema: schema,
      });
      expect(turns[0].content).toContain('JSON Schema');
      expect(turns[0].content).toContain('"name"');
    });
  });
});
