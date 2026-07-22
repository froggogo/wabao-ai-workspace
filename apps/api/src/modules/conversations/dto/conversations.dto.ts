import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { ModelId } from '../../../ai/models';

const MODEL_IDS: ModelId[] = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];

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
