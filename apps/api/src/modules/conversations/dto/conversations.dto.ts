import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { ModelId } from '../../../ai/models';

const MODEL_IDS: ModelId[] = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export class CreateConversationDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  @IsIn(MODEL_IDS)
  model?: ModelId;

  @IsString()
  @IsOptional()
  assistant_id?: string;
}

export class UpdateConversationDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsBoolean()
  @IsOptional()
  pinned?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(MODEL_IDS)
  model?: ModelId;

  @IsString()
  @IsOptional()
  assistant_id?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsString()
  @IsOptional()
  @IsIn(REASONING_EFFORTS)
  reasoning_effort?: ReasoningEffort;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: '消息内容不能为空' })
  content!: string;

  @IsBoolean()
  @IsOptional()
  stream?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(MODEL_IDS)
  model?: ModelId;
}

export class FeedbackDto {
  @IsString()
  @IsIn(['up', 'down'])
  rating!: 'up' | 'down';

  @IsString()
  @IsOptional()
  comment?: string;
}
