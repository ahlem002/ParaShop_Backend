import { IsString, IsUUID } from 'class-validator';

export class AssignDriverDto {
  @IsUUID()
  deliveryUserId: string;
}
