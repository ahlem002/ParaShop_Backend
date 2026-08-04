import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CheckoutDto } from './dto/checkout.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.CLIENT)
  checkout(@CurrentUser() user: JwtPayload, @Body() dto: CheckoutDto) {
    return this.ordersService.checkout(user.sub, dto);
  }

  @Get('mine')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.CLIENT)
  listMine(@CurrentUser() user: JwtPayload) {
    return this.ordersService.listMyOrders(user.sub);
  }

  @Get('mine/:orderId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.CLIENT)
  getMine(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.getMyOrder(user.sub, orderId);
  }

  @Delete('mine/:orderId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.CLIENT)
  deleteMine(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.deleteMyOrder(user.sub, orderId);
  }

  @Post('mine/:orderId/cancel')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.CLIENT)
  cancelMine(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.cancelMyOrder(user.sub, orderId);
  }

  @Post('mine/:orderId/verify')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.CLIENT)
  verifyMine(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.verifyAndConfirm(orderId, user.sub);
  }

  /** Flouci server-to-server webhook (no JWT). Always re-verifies with Flouci. */
  @Post('flouci/webhook')
  flouciWebhook(@Body() body: Record<string, unknown>) {
    return this.ordersService.handleFlouciWebhook(body);
  }
}
