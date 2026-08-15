import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApprovedCompanyGuard } from '../auth/guards/approved-company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AssignDriverDto } from './dto/assign-driver.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@Controller('company/orders')
@UseGuards(AuthGuard('jwt'), RolesGuard, ApprovedCompanyGuard)
@Roles(Role.COMPANY)
export class CompanyOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  listMine(@CurrentUser() user: JwtPayload) {
    return this.ordersService.listCompanyOrders(user.sub);
  }

  @Get('drivers/available')
  listDrivers(@Query('freeOnly') freeOnly?: string) {
    return this.ordersService.listAvailableDrivers(freeOnly === 'true');
  }

  @Get(':orderId')
  getMine(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.getCompanyOrder(user.sub, orderId);
  }

  @Patch(':orderId/status')
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateCompanyOrderStatus(
      user.sub,
      orderId,
      dto.status,
    );
  }

  @Post(':orderId/assign-driver')
  assignDriver(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Body() dto: AssignDriverDto,
  ) {
    return this.ordersService.assignDriverToOrder(
      user.sub,
      orderId,
      dto.deliveryUserId,
    );
  }
}
