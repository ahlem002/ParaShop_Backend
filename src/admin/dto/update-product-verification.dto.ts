import { IsEnum, IsString, MinLength, ValidateIf } from 'class-validator';
import { ApprovalDecision } from '../../common/enums/approval-decision.enum';

export class UpdateProductVerificationDto {
  @IsEnum(ApprovalDecision)
  decision: ApprovalDecision;

  @ValidateIf(
    (dto: UpdateProductVerificationDto) =>
      dto.decision === ApprovalDecision.REJECTED,
  )
  @IsString()
  @MinLength(3, { message: 'Rejection reason is required' })
  reason?: string;
}
