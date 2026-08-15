import { IsIn } from 'class-validator';
import { OrderStatus } from '../../common/enums/order-status.enum';

/** Fulfillment statuses a company may set without assigning a driver. */
export const COMPANY_UPDATABLE_STATUSES = [OrderStatus.PROCESSING] as const;

export type CompanyUpdatableStatus =
  (typeof COMPANY_UPDATABLE_STATUSES)[number];

export class UpdateOrderStatusDto {
  @IsIn([...COMPANY_UPDATABLE_STATUSES], {
    message: `status must be one of: ${COMPANY_UPDATABLE_STATUSES.join(', ')}`,
  })
  status: CompanyUpdatableStatus;
}
