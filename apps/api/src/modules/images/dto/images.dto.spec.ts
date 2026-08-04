import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MAX_ANALYZE_IMAGES, MAX_CAPTION_IMAGES } from '@wabao/shared';
import {
  AnalyzeImageDto,
  CaptionImageDto,
  CreateVariationDto,
  GenerateImageDto,
} from './images.dto';

/** 校验 DTO，返回出错的字段名集合 */
function invalidFields(cls: new () => object, payload: unknown): string[] {
  const dto = plainToInstance(cls, payload);
  return validateSync(dto as object).map((e) => e.property);
}

describe('图像 DTO 校验（入参边界）', () => {
  describe('GenerateImageDto', () => {
    it('接受最小合法载荷（其余走后端默认值）', () => {
      expect(invalidFields(GenerateImageDto, { prompt: '青蛙' })).toEqual([]);
    });

    it('接受完整合法载荷', () => {
      expect(
        invalidFields(GenerateImageDto, {
          prompt: '星云中的青蛙',
          model: 'gpt-image-2',
          size: '1536x1024',
          style: 'render3d',
          n: 4,
          stream: true,
        }),
      ).toEqual([]);
    });

    it('prompt 少于 2 字符被拒绝', () => {
      expect(invalidFields(GenerateImageDto, { prompt: 'a' })).toContain('prompt');
    });

    it('prompt 缺失或超长被拒绝', () => {
      expect(invalidFields(GenerateImageDto, {})).toContain('prompt');
      expect(invalidFields(GenerateImageDto, { prompt: 'x'.repeat(2001) })).toContain('prompt');
    });

    it('拒绝目录外的模型 / 尺寸 / 风格（防脏参数落库）', () => {
      expect(invalidFields(GenerateImageDto, { prompt: 'ok', model: 'dall-e-3' })).toContain(
        'model',
      );
      expect(invalidFields(GenerateImageDto, { prompt: 'ok', size: '4096x4096' })).toContain(
        'size',
      );
      expect(invalidFields(GenerateImageDto, { prompt: 'ok', style: 'cyberpunk' })).toContain(
        'style',
      );
    });

    it('n 必须是 1..4 的整数', () => {
      expect(invalidFields(GenerateImageDto, { prompt: 'ok', n: 0 })).toContain('n');
      expect(invalidFields(GenerateImageDto, { prompt: 'ok', n: 5 })).toContain('n');
      expect(invalidFields(GenerateImageDto, { prompt: 'ok', n: 1.5 })).toContain('n');
      expect(invalidFields(GenerateImageDto, { prompt: 'ok', n: 4 })).toEqual([]);
    });
  });

  describe('CreateVariationDto', () => {
    it('允许空载荷（默认沿用源图参数）', () => {
      expect(invalidFields(CreateVariationDto, {})).toEqual([]);
    });

    it('接受可选的描述与尺寸', () => {
      expect(invalidFields(CreateVariationDto, { prompt: '换个配色', size: '1024x1536' })).toEqual(
        [],
      );
    });

    it('拒绝非法尺寸', () => {
      expect(invalidFields(CreateVariationDto, { size: '800x600' })).toContain('size');
    });

    // whitelist:true 会剥离未声明的字段，缺了 stream 声明就等于不支持非流式
    it('接受 stream 参数（与文生图一致，支持非流式）', () => {
      expect(invalidFields(CreateVariationDto, { stream: false })).toEqual([]);
    });

    it('stream 必须是布尔值', () => {
      expect(invalidFields(CreateVariationDto, { stream: 'no' })).toContain('stream');
    });
  });

  describe('AnalyzeImageDto', () => {
    it('接受合法载荷', () => {
      expect(
        invalidFields(AnalyzeImageDto, {
          image_urls: ['/uploads/a.png'],
          question: '这是什么？',
        }),
      ).toEqual([]);
    });

    it('image_urls 必须是字符串数组', () => {
      expect(invalidFields(AnalyzeImageDto, { image_urls: 'a.png', question: 'q' })).toContain(
        'image_urls',
      );
      expect(invalidFields(AnalyzeImageDto, { image_urls: [123], question: 'q' })).toContain(
        'image_urls',
      );
    });

    it('question 不能为空且不能超长', () => {
      expect(invalidFields(AnalyzeImageDto, { image_urls: ['/a.png'], question: '' })).toContain(
        'question',
      );
      expect(
        invalidFields(AnalyzeImageDto, { image_urls: ['/a.png'], question: 'x'.repeat(2001) }),
      ).toContain('question');
    });

    it('空数组通过 DTO 校验，由 Service 层给出业务报错', () => {
      // 说明：数组为空属业务规则（ImagesService.analyze 抛 invalid_request），
      // 不在 DTO 层用 ArrayMinSize 拦截，避免两处规则重复维护。
      expect(invalidFields(AnalyzeImageDto, { image_urls: [], question: 'q' })).toEqual([]);
    });

    it('可选传入 conversation_id 以便落库到指定会话', () => {
      expect(
        invalidFields(AnalyzeImageDto, {
          image_urls: ['/a.png'],
          question: 'q',
          conversation_id: 'c1',
        }),
      ).toEqual([]);
    });

    // 无上限时可传任意多张图放大成本，与 caption 一致地设界
    it('图片数量超过上限被拒绝', () => {
      expect(
        invalidFields(AnalyzeImageDto, {
          image_urls: Array(MAX_ANALYZE_IMAGES + 1).fill('/a.png'),
          question: 'q',
        }),
      ).toContain('image_urls');
    });

    it('图片数量等于上限时通过', () => {
      expect(
        invalidFields(AnalyzeImageDto, {
          image_urls: Array(MAX_ANALYZE_IMAGES).fill('/a.png'),
          question: 'q',
        }),
      ).toEqual([]);
    });
  });

  describe('CaptionImageDto', () => {
    it('仅传图片即可（用途与语气走默认值）', () => {
      expect(invalidFields(CaptionImageDto, { image_urls: ['/uploads/a.png'] })).toEqual([]);
    });

    it('接受完整合法载荷', () => {
      expect(
        invalidFields(CaptionImageDto, {
          image_urls: ['/uploads/a.png', '/uploads/b.png'],
          purpose: 'marketing',
          tone: 'professional',
          brief: '主打保温 12 小时',
          stream: true,
        }),
      ).toEqual([]);
    });

    it('拒绝目录外的用途与语气', () => {
      expect(invalidFields(CaptionImageDto, { image_urls: ['/a.png'], purpose: 'tiktok' })).toContain(
        'purpose',
      );
      expect(invalidFields(CaptionImageDto, { image_urls: ['/a.png'], tone: 'angry' })).toContain(
        'tone',
      );
    });

    it('参考图数量超过上限被拒绝', () => {
      const tooMany = Array.from({ length: MAX_CAPTION_IMAGES + 1 }, (_, i) => `/uploads/${i}.png`);
      expect(invalidFields(CaptionImageDto, { image_urls: tooMany })).toContain('image_urls');
    });

    it('刚好达到上限时通过（边界值）', () => {
      const exact = Array.from({ length: MAX_CAPTION_IMAGES }, (_, i) => `/uploads/${i}.png`);
      expect(invalidFields(CaptionImageDto, { image_urls: exact })).toEqual([]);
    });

    it('补充要求超长被拒绝', () => {
      expect(
        invalidFields(CaptionImageDto, { image_urls: ['/a.png'], brief: 'x'.repeat(1001) }),
      ).toContain('brief');
    });
  });
});
