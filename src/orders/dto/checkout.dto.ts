import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CheckoutDto {
  @IsUUID()
  companyId: string;

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
