import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { VerificationStatus } from '../../common/enums/verification-status.enum';
import { AuthenticatedRequest } from '../interfaces/jwt-payload.interface';

@Injectable()
export class ApprovedCompanyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (user.role !== Role.COMPANY) {
      return true;
    }

    if (user.companyVerificationStatus !== VerificationStatus.APPROVED) {
      throw new ForbiddenException(
        'Your company account is not approved yet. Please wait for admin validation.',
      );
    }

    return true;
  }
}
