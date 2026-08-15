import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OrderStatus } from '../../common/enums/order-status.enum';

export const DELIVERY_UPDATABLE_STATUSES = [
  OrderStatus.DELIVERED,
  OrderStatus.RETURNED,
] as const;

export type DeliveryUpdatableStatus =
  (typeof DELIVERY_UPDATABLE_STATUSES)[number];

export class UpdateDeliveryOrderStatusDto {
  @IsIn([...DELIVERY_UPDATABLE_STATUSES], {
    message: `status must be one of: ${DELIVERY_UPDATABLE_STATUSES.join(', ')}`,
  })
  status: DeliveryUpdatableStatus;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note?: string;
}
