import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @IsString()
  @IsOptional()
  @MaxLength(50)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  avatar?: string;
}
