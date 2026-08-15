import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BuyNowDto {
  @IsUUID()
  productId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  quantity: number;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  shippingAddress: string;

  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phoneNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}
