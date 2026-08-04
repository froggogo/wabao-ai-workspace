import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CAPTION_PURPOSE_IDS,
  CAPTION_TONE_IDS,
  CaptionPurposeId,
  CaptionToneId,
  IMAGE_MODEL_IDS,
  IMAGE_SIZE_IDS,
  IMAGE_STYLE_IDS,
  ImageModelId,
  ImageSizeId,
  ImageStyleId,
  MAX_ANALYZE_IMAGES,
  MAX_CAPTION_IMAGES,
  MAX_IMAGES_PER_REQUEST,
} from '@wabao/shared';

export class GenerateImageDto {
  @IsString()
  @MinLength(2, { message: 'prompt 至少 2 个字符' })
  @MaxLength(2000)
  prompt!: string;

  @IsOptional()
  @IsIn(IMAGE_MODEL_IDS)
  model?: ImageModelId;

  @IsOptional()
  @IsIn(IMAGE_SIZE_IDS)
  size?: ImageSizeId;

  @IsOptional()
  @IsIn(IMAGE_STYLE_IDS)
  style?: ImageStyleId;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_IMAGES_PER_REQUEST)
  n?: number;

  /** 是否使用 SSE 流式返回进度（默认 true） */
  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}

export class CreateVariationDto {
  /** 变体附加描述，可为空 */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @IsOptional()
  @IsIn(IMAGE_SIZE_IDS)
  size?: ImageSizeId;

  /** 是否使用 SSE 流式返回进度（默认 true），与文生图保持一致 */
  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}

export class AnalyzeImageDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_ANALYZE_IMAGES, {
    message: `一次最多可携带 ${MAX_ANALYZE_IMAGES} 张图片`,
  })
  image_urls!: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question!: string;

  /**
   * 可选。传入会话 id 时，本轮看图问答会作为消息落库到该会话，
   * 使贴图对话与普通文字对话一样可在刷新后回看。
   */
  @IsOptional()
  @IsString()
  conversation_id?: string;

  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}

/** 图 → 文案（M5 × M3 联动） */
export class CaptionImageDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_CAPTION_IMAGES, {
    message: `一次最多上传 ${MAX_CAPTION_IMAGES} 张参考图`,
  })
  image_urls!: string[];

  /** 文案用途（渠道体裁） */
  @IsOptional()
  @IsIn(CAPTION_PURPOSE_IDS)
  purpose?: CaptionPurposeId;

  /** 语气 */
  @IsOptional()
  @IsIn(CAPTION_TONE_IDS)
  tone?: CaptionToneId;

  /** 补充要求，如产品名、目标人群、必须提到的卖点 */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  brief?: string;

  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}
