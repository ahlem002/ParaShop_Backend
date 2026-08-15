import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PromotionOfferType } from '../../common/enums/promotion-offer-type.enum';

export class UpdatePromotionOfferDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  defaultDurationDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreatePriceOverrideDto {
  @IsEnum(PromotionOfferType)
  offerType: PromotionOfferType;

  @IsOptional()
  @IsUUID()
  productId?: string | null;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays?: number;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class CreatePromotionCampaignDto {
  @IsEnum(PromotionOfferType)
  offerType: PromotionOfferType;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  productIds: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays: number;
}

export class QuotePromotionDto {
  @IsEnum(PromotionOfferType)
  offerType: PromotionOfferType;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  productIds: string[];
}
