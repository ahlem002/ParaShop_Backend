import { Request } from 'express';
import { Role } from '../../common/enums/role.enum';
import { VerificationStatus } from '../../common/enums/verification-status.enum';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  companyVerificationStatus?: VerificationStatus | null;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
