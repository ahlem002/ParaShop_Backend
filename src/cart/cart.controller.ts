import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Controller('cart')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.CLIENT)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  getCart(@CurrentUser() user: JwtPayload) {
    return this.cartService.getCart(user.sub);
  }

  @Post('items')
  addItem(@CurrentUser() user: JwtPayload, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(user.sub, dto);
  }

  @Patch('items/:cartItemId')
  updateItem(
    @CurrentUser() user: JwtPayload,
    @Param('cartItemId') cartItemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(user.sub, cartItemId, dto);
  }

  @Delete('items/:cartItemId')
  removeItem(
    @CurrentUser() user: JwtPayload,
    @Param('cartItemId') cartItemId: string,
  ) {
    return this.cartService.removeItem(user.sub, cartItemId);
  }

  @Delete()
  clear(@CurrentUser() user: JwtPayload) {
    return this.cartService.clear(user.sub);
  }

  @Delete('company/:companyId')
  clearCompany(
    @CurrentUser() user: JwtPayload,
    @Param('companyId') companyId: string,
  ) {
    return this.cartService.clearCompany(user.sub, companyId);
  }
}
