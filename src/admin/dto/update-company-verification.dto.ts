import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApprovalDecision } from '../../common/enums/approval-decision.enum';

export class UpdateCompanyVerificationDto {
  @IsEnum(ApprovalDecision)
  decision: ApprovalDecision;

  @IsOptional()
  @IsString()
  reason?: string;
}
