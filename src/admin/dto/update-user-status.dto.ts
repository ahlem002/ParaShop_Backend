import { IsEnum } from 'class-validator';
import { UserStatus } from '../../common/enums/user-status.enum';

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;
}
