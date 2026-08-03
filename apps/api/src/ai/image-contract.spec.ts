import {
  CAPTION_PURPOSES,
  CAPTION_PURPOSE_IDS,
  CAPTION_TONES,
  CAPTION_TONE_IDS,
  DEFAULT_CAPTION_PURPOSE,
  DEFAULT_CAPTION_TONE,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_IMAGE_STYLE,
  IMAGE_MODELS,
  IMAGE_MODEL_IDS,
  IMAGE_SIZES,
  IMAGE_SIZE_IDS,
  IMAGE_STYLES,
  IMAGE_STYLE_IDS,
  IMAGE_UPLOAD_MAX_BYTES,
  IMAGE_UPLOAD_MIME_TYPES,
  MAX_CAPTION_IMAGES,
  MAX_IMAGES_PER_REQUEST,
  PLAN_IMAGE_LIMITS,
  captionPurposeHint,
  captionToneHint,
  estimateImageCost,
  imageLimitsForPlan,
  imageStyleHint,
  isImageModelAllowed,
  isImageStyleAllowed,
  isValidCaptionPurpose,
  isValidCaptionTone,
  isValidImageModel,
  isValidImageSize,
  isValidImageStyle,
} from '@wabao/shared';
import type { PlanId } from '@wabao/shared';

const ALL_PLANS = Object.keys(PLAN_IMAGE_LIMITS) as PlanId[];
const PAID_PLANS: PlanId[] = ['plus', 'pro', 'team', 'enterprise'];

/**
 * P2 图像契约测试。
 * 这些常量是前后端唯一事实来源（后端做权益校验、前端做界面渲染都依赖它），
 * 因此对「目录完整性」与「套餐权益矩阵」做强约束，防止误改导致前后端不一致。
 */
describe('shared/图像契约（P2 · M5）', () => {
  describe('模型 / 尺寸 / 风格目录', () => {
    it('默认值必须存在于各自目录中', () => {
      expect(IMAGE_MODEL_IDS).toContain(DEFAULT_IMAGE_MODEL);
      expect(IMAGE_SIZE_IDS).toContain(DEFAULT_IMAGE_SIZE);
      expect(IMAGE_STYLE_IDS).toContain(DEFAULT_IMAGE_STYLE);
    });

    it('各目录 id 唯一', () => {
      for (const ids of [IMAGE_MODEL_IDS, IMAGE_SIZE_IDS, IMAGE_STYLE_IDS]) {
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it('每个模型都有正数单价与展示名（用于成本估算与前端展示）', () => {
      for (const m of IMAGE_MODELS) {
        expect(m.pricePerImage).toBeGreaterThan(0);
        expect(m.name.length).toBeGreaterThan(0);
        expect(m.desc.length).toBeGreaterThan(0);
      }
    });

    it('尺寸 id 与宽高自洽，且 ratio 与实际宽高比一致', () => {
      for (const s of IMAGE_SIZES) {
        expect(s.width).toBeGreaterThan(0);
        expect(s.height).toBeGreaterThan(0);
        // id 形如 "1024x1536"，必须与 width/height 对应，否则后端按 id 解析尺寸会错
        expect(s.id).toBe(`${s.width}x${s.height}`);
        const [rw, rh] = s.ratio.split(':').map(Number);
        expect(s.width / s.height).toBeCloseTo(rw / rh, 2);
      }
    });

    it('尺寸覆盖方形 / 竖版 / 横版三种版式', () => {
      const kinds = IMAGE_SIZES.map((s) =>
        s.width === s.height ? 'square' : s.width > s.height ? 'landscape' : 'portrait',
      );
      expect(new Set(kinds)).toEqual(new Set(['square', 'landscape', 'portrait']));
    });

    it('风格都带有 label 与渐变色卡（前端色块渲染依赖 swatch）', () => {
      for (const s of IMAGE_STYLES) {
        expect(s.label.length).toBeGreaterThan(0);
        expect(s.swatch).toMatch(/^from-.+\sto-.+$/);
      }
    });

    it('imageStyleHint：auto 无提示词，其余风格均有提示词', () => {
      expect(imageStyleHint('auto')).toBe('');
      for (const s of IMAGE_STYLES.filter((x) => x.id !== 'auto')) {
        expect(imageStyleHint(s.id).length).toBeGreaterThan(0);
      }
    });
  });

  describe('类型守卫', () => {
    it('识别合法值', () => {
      expect(isValidImageModel(DEFAULT_IMAGE_MODEL)).toBe(true);
      expect(isValidImageSize(DEFAULT_IMAGE_SIZE)).toBe(true);
      expect(isValidImageStyle(DEFAULT_IMAGE_STYLE)).toBe(true);
    });

    it('拒绝非法值（防止脏参数进入后端）', () => {
      expect(isValidImageModel('dall-e-2')).toBe(false);
      expect(isValidImageSize('9999x9999')).toBe(false);
      expect(isValidImageStyle('cyberpunk')).toBe(false);
      expect(isValidImageModel('')).toBe(false);
      expect(isValidImageSize('')).toBe(false);
      expect(isValidImageStyle('')).toBe(false);
    });
  });

  describe('套餐图像权益矩阵', () => {
    it('五个套餐都有图像权益配置', () => {
      expect(ALL_PLANS).toHaveLength(5);
      for (const plan of ALL_PLANS) {
        expect(PLAN_IMAGE_LIMITS[plan]).toBeDefined();
      }
    });

    it('免费版：仅 Mini 模型 / 单张 / 基础风格 / 无 Vision', () => {
      const free = PLAN_IMAGE_LIMITS.free;
      expect(free.allowedModels).toEqual(['gpt-image-2-mini']);
      expect(free.maxBatch).toBe(1);
      expect(free.allowedStyles).toBe('basic');
      expect(free.vision).toBe(false);
      expect(free.monthlyImages).toBeGreaterThan(0);
    });

    it('付费套餐：全模型 / 可批量 / 全风格 / 有 Vision', () => {
      for (const plan of PAID_PLANS) {
        const l = PLAN_IMAGE_LIMITS[plan];
        expect([...l.allowedModels].sort()).toEqual([...IMAGE_MODEL_IDS].sort());
        expect(l.allowedStyles).toBe('all');
        expect(l.vision).toBe(true);
        expect(l.maxBatch).toBeGreaterThan(1);
      }
    });

    it('企业版为不限量（monthlyImages = 0 作为哨兵值）', () => {
      expect(PLAN_IMAGE_LIMITS.enterprise.monthlyImages).toBe(0);
    });

    it('付费档位的月度额度严格高于免费版', () => {
      for (const plan of ['plus', 'pro', 'team'] as PlanId[]) {
        expect(PLAN_IMAGE_LIMITS[plan].monthlyImages).toBeGreaterThan(
          PLAN_IMAGE_LIMITS.free.monthlyImages,
        );
      }
    });

    it('maxBatch 不得超过全局上限 MAX_IMAGES_PER_REQUEST', () => {
      for (const plan of ALL_PLANS) {
        expect(PLAN_IMAGE_LIMITS[plan].maxBatch).toBeLessThanOrEqual(MAX_IMAGES_PER_REQUEST);
        expect(PLAN_IMAGE_LIMITS[plan].maxBatch).toBeGreaterThanOrEqual(1);
      }
    });

    it('imageLimitsForPlan 对未知套餐回退为免费版（安全默认）', () => {
      expect(imageLimitsForPlan('unknown' as PlanId)).toEqual(PLAN_IMAGE_LIMITS.free);
    });
  });

  describe('isImageModelAllowed', () => {
    it('免费版不可用旗舰模型，Plus 可用', () => {
      expect(isImageModelAllowed('free', 'gpt-image-2')).toBe(false);
      expect(isImageModelAllowed('free', 'gpt-image-2-mini')).toBe(true);
      expect(isImageModelAllowed('plus', 'gpt-image-2')).toBe(true);
    });
  });

  describe('isImageStyleAllowed', () => {
    it('免费版可用的 4 种基础风格', () => {
      for (const id of ['auto', 'photo', 'illustration', 'flat'] as const) {
        expect(isImageStyleAllowed('free', id)).toBe(true);
      }
      const allowed = IMAGE_STYLES.filter((s) => isImageStyleAllowed('free', s.id));
      expect(allowed).toHaveLength(4);
    });

    it('免费版不可用进阶风格，但付费版全部开放', () => {
      const advanced = IMAGE_STYLES.filter((s) => !isImageStyleAllowed('free', s.id));
      expect(advanced.length).toBeGreaterThan(0);
      for (const s of advanced) {
        expect(isImageStyleAllowed('plus', s.id)).toBe(true);
      }
    });

    it('付费套餐开放全部风格', () => {
      for (const plan of PAID_PLANS) {
        for (const s of IMAGE_STYLES) {
          expect(isImageStyleAllowed(plan, s.id)).toBe(true);
        }
      }
    });
  });

  describe('estimateImageCost', () => {
    it('按张数线性计价', () => {
      const one = estimateImageCost('gpt-image-2-mini', 1);
      expect(estimateImageCost('gpt-image-2-mini', 3)).toBeCloseTo(one * 3, 4);
    });

    it('0 张成本为 0', () => {
      expect(estimateImageCost('gpt-image-2-mini', 0)).toBe(0);
    });

    it('旗舰模型比 Mini 更贵', () => {
      expect(estimateImageCost('gpt-image-2', 1)).toBeGreaterThan(
        estimateImageCost('gpt-image-2-mini', 1),
      );
    });

    it('与目录单价一致', () => {
      for (const m of IMAGE_MODELS) {
        expect(estimateImageCost(m.id, 1)).toBeCloseTo(m.pricePerImage, 4);
      }
    });
  });

  describe('上传限制', () => {
    it('仅允许常见位图格式，且不含 SVG（避免 XSS 风险）', () => {
      expect(IMAGE_UPLOAD_MIME_TYPES).toContain('image/png');
      expect(IMAGE_UPLOAD_MIME_TYPES).toContain('image/jpeg');
      expect(IMAGE_UPLOAD_MIME_TYPES).toContain('image/webp');
      expect(IMAGE_UPLOAD_MIME_TYPES).not.toContain('image/svg+xml');
    });

    it('体积上限为 10MB', () => {
      expect(IMAGE_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
    });
  });

  // ---------------- 图 → 文案契约 ----------------

  describe('图 → 文案（M5 × M3）', () => {
    it('默认用途与语气存在于目录中', () => {
      expect(CAPTION_PURPOSE_IDS).toContain(DEFAULT_CAPTION_PURPOSE);
      expect(CAPTION_TONE_IDS).toContain(DEFAULT_CAPTION_TONE);
    });

    it('用途 id 唯一，且都带图标 / 说明 / 提示词', () => {
      const ids = CAPTION_PURPOSES.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const p of CAPTION_PURPOSES) {
        expect(p.label.length).toBeGreaterThan(0);
        expect(p.icon.length).toBeGreaterThan(0);
        expect(p.desc.length).toBeGreaterThan(0);
        expect(p.promptHint.length).toBeGreaterThan(0);
      }
    });

    it('覆盖核心渠道场景（小红书 / 营销 / 电商 / 无障碍）', () => {
      for (const id of ['xiaohongshu', 'marketing', 'ecommerce', 'alt_text']) {
        expect(CAPTION_PURPOSE_IDS).toContain(id);
      }
    });

    it('语气 id 唯一且都有提示词', () => {
      const ids = CAPTION_TONES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const t of CAPTION_TONES) {
        expect(t.promptHint.length).toBeGreaterThan(0);
      }
    });

    it('类型守卫可识别合法值并拒绝非法值', () => {
      expect(isValidCaptionPurpose('xiaohongshu')).toBe(true);
      expect(isValidCaptionPurpose('tiktok')).toBe(false);
      expect(isValidCaptionTone('friendly')).toBe(true);
      expect(isValidCaptionTone('angry')).toBe(false);
    });

    it('提示词查询函数返回目录中的内容', () => {
      for (const p of CAPTION_PURPOSES) {
        expect(captionPurposeHint(p.id)).toBe(p.promptHint);
      }
      for (const t of CAPTION_TONES) {
        expect(captionToneHint(t.id)).toBe(t.promptHint);
      }
    });

    it('参考图数量上限为正数且不超过合理范围', () => {
      expect(MAX_CAPTION_IMAGES).toBeGreaterThan(0);
      expect(MAX_CAPTION_IMAGES).toBeLessThanOrEqual(8);
    });
  });
});
