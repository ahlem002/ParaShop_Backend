import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UpdateDeliveryOrderStatusDto } from './dto/update-delivery-order-status.dto';
import { OrdersService } from './orders.service';

@Controller('delivery/orders')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.DELIVERY)
export class DeliveryOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  listMine(
    @CurrentUser() user: JwtPayload,
    @Query('scope') scope?: 'active' | 'history' | 'all',
  ) {
    return this.ordersService.listDeliveryOrders(user.sub, scope ?? 'all');
  }

  @Get(':orderId')
  getMine(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.getDeliveryOrder(user.sub, orderId);
  }

  @Patch(':orderId/status')
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Body() dto: UpdateDeliveryOrderStatusDto,
  ) {
    return this.ordersService.updateDeliveryOrderStatus(
      user.sub,
      orderId,
      dto.status,
      dto.note,
    );
  }
}
