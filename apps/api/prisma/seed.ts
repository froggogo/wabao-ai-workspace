import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// 与前端原型 mockData.ts 中的模板保持一致，作为平台级模板注入
const templates: Prisma.TemplateCreateInput[] = [
  {
    id: 'tpl_weekly',
    name: '周报生成',
    category: '办公',
    icon: '📄',
    description: '根据本周工作要点，一键生成结构清晰的周报。',
    prompt:
      '你是办公助理。请根据用户提供的「本周完成」「下周计划」以及语言风格，输出结构清晰的 Markdown 周报，包含"本周完成""下周计划""风险与需要支持"三个小节。',
    inputSchema: {
      fields: [
        { key: 'done', label: '本周完成', type: 'textarea', required: true, placeholder: '完成了 A 功能、修复了 B 问题…' },
        { key: 'plan', label: '下周计划', type: 'textarea', placeholder: '推进 C、评审 D…' },
        { key: 'style', label: '语言风格', type: 'select', options: ['正式', '轻松'], default: '正式' },
      ],
    },
    outputSchema: Prisma.DbNull,
  },
  {
    id: 'tpl_rednote',
    name: '小红书文案',
    category: '营销',
    icon: '📢',
    description: '输入产品与卖点，生成带 emoji 的种草文案。',
    prompt:
      '你是小红书爆款文案专家。根据「产品名称」「核心卖点」「语气」，写一段带 emoji、有感染力、口语化的种草文案，并在结尾加上相关话题标签。',
    inputSchema: {
      fields: [
        { key: 'product', label: '产品名称', type: 'text', required: true, placeholder: '如：便携榨汁杯' },
        { key: 'points', label: '核心卖点', type: 'textarea', required: true, placeholder: '便携、易清洗、颜值高…' },
        { key: 'tone', label: '语气', type: 'select', options: ['种草', '测评', '教程'], default: '种草' },
      ],
    },
    outputSchema: Prisma.DbNull,
  },
  {
    id: 'tpl_email',
    name: '邮件撰写',
    category: '办公',
    icon: '✉️',
    description: '根据要点生成得体的商务邮件。',
    prompt: '你是商务沟通助理。根据「收件对象」与「邮件目的」，写一封礼貌、得体、条理清晰的中文商务邮件。',
    inputSchema: {
      fields: [
        { key: 'to', label: '收件对象', type: 'text', required: true, placeholder: '如：合作方王经理' },
        { key: 'purpose', label: '邮件目的', type: 'textarea', required: true, placeholder: '确认下周会议时间…' },
      ],
    },
    outputSchema: Prisma.DbNull,
  },
  {
    id: 'tpl_outline',
    name: '文章大纲',
    category: '写作',
    icon: '📝',
    description: '输入主题，生成分级文章大纲。',
    prompt: '你是资深编辑。根据「文章主题」，生成一个逻辑清晰、分级合理的 Markdown 文章大纲。',
    inputSchema: {
      fields: [{ key: 'topic', label: '文章主题', type: 'text', required: true, placeholder: '如：如何做好时间管理' }],
    },
    outputSchema: Prisma.DbNull,
  },
  {
    id: 'tpl_code',
    name: '代码解释',
    category: '代码',
    icon: '🧩',
    description: '粘贴代码，生成逐行解释。',
    prompt: '你是资深软件工程师。请对用户提供的「代码片段」进行讲解，说明其作用、关键逻辑，并给出可改进的建议。',
    inputSchema: {
      fields: [{ key: 'code', label: '代码片段', type: 'textarea', required: true, placeholder: '粘贴你的代码…' }],
    },
    outputSchema: Prisma.DbNull,
  },
  {
    id: 'tpl_extract',
    name: '信息抽取（结构化）',
    category: '办公',
    icon: '🗂️',
    description: '从一段文本中抽取结构化字段（演示结构化输出）。',
    prompt: '你是信息抽取助手。从用户提供的「原始文本」中抽取关键字段，并严格按给定 JSON Schema 输出。',
    inputSchema: {
      fields: [
        { key: 'text', label: '原始文本', type: 'textarea', required: true, placeholder: '张三，13800000000，负责华东区销售…' },
      ],
    },
    // 结构化输出示例 Schema
    outputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '姓名' },
        phone: { type: 'string', description: '电话' },
        region: { type: 'string', description: '负责区域' },
        role: { type: 'string', description: '职位/角色' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
];

async function main() {
  for (const tpl of templates) {
    await prisma.template.upsert({
      where: { id: tpl.id },
      update: tpl,
      create: tpl,
    });
  }
  console.log(`✅ 已注入 ${templates.length} 个模板`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
