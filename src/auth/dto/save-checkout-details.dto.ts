import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SaveCheckoutDetailsDto {
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  cardName?: string;

  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(32)
  cardNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(7)
  cardExpiry?: string;
}
