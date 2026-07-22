import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateCreationDto {
  @IsString()
  template_id!: string;

  @IsObject()
  inputs!: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  stream?: boolean;
}
