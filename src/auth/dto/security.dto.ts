import { IsString, Length, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class TwoFactorCodeDto {
  @IsString()
  @Length(6, 6)
  code: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

export class VerifyTwoFactorLoginDto {
  @IsString()
  tempToken: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
