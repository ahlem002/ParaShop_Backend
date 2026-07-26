import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { CompanyType } from '../../common/enums/company-type.enum';

export class RegisterCompanyDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsString()
  @IsNotEmpty()
  companyName: string;

  @IsEnum(CompanyType)
  companyType: CompanyType;

  @IsDateString()
  establishmentDate: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  companyPhoneNumber?: string;

  @IsOptional()
  @IsString()
  proofDocument?: string;
}
