import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CompanyType } from '../../common/enums/company-type.enum';
import { UserStatus } from '../../common/enums/user-status.enum';

export class UpdateAdminCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  companyName?: string;

  @IsOptional()
  @IsEnum(CompanyType)
  companyType?: CompanyType;

  @IsOptional()
  @IsString()
  establishmentDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  ownerFirstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  ownerLastName?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  ownerStatus?: UserStatus;
}
