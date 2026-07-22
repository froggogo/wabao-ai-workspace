import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ModelId } from '../../../ai/models';

const MODEL_IDS: ModelId[] = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];

export class CreateAssistantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @IsString()
  system_prompt!: string;

  @IsString()
  @IsOptional()
  @IsIn(MODEL_IDS)
  default_model?: ModelId;

  @IsString()
  @IsOptional()
  avatar?: string;
}

export class UpdateAssistantDto {
  @IsString()
  @IsOptional()
  @MaxLength(50)
  name?: string;

  @IsString()
  @IsOptional()
  system_prompt?: string;

  @IsString()
  @IsOptional()
  @IsIn(MODEL_IDS)
  default_model?: ModelId;

  @IsString()
  @IsOptional()
  avatar?: string;
}
