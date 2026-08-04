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
import { AddFavoriteDto } from './dto/add-favorite.dto';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.CLIENT)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.favoritesService.list(user.sub);
  }

  @Post()
  add(@CurrentUser() user: JwtPayload, @Body() dto: AddFavoriteDto) {
    return this.favoritesService.add(user.sub, dto.productId);
  }

  @Post('toggle')
  toggle(@CurrentUser() user: JwtPayload, @Body() dto: AddFavoriteDto) {
    return this.favoritesService.toggle(user.sub, dto.productId);
  }

  @Delete(':productId')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('productId') productId: string,
  ) {
    return this.favoritesService.remove(user.sub, productId);
  }
}
