import {
  Body,
  Controller,
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
import {
  CreatePriceOverrideDto,
  UpdatePromotionOfferDto,
} from './dto/promotion.dto';
import { PromotionsService } from './promotions.service';

@Controller('admin/promotions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
export class AdminPromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get('offers')
  listOffers() {
    return this.promotionsService.listOffers();
  }

  @Patch('offers/:offerId')
  updateOffer(
    @Param('offerId') offerId: string,
    @Body() dto: UpdatePromotionOfferDto,
  ) {
    return this.promotionsService.updateOffer(offerId, dto);
  }

  @Get('overrides')
  listOverrides() {
    return this.promotionsService.listOverrides();
  }

  @Post('overrides')
  createOverride(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: CreatePriceOverrideDto,
  ) {
    return this.promotionsService.createOverride(admin.sub, dto);
  }

  @Post('overrides/:overrideId/deactivate')
  deactivateOverride(@Param('overrideId') overrideId: string) {
    return this.promotionsService.deactivateOverride(overrideId);
  }

  @Get('campaigns')
  listCampaigns() {
    return this.promotionsService.listAllCampaigns();
  }

  @Get('revenue')
  getRevenue() {
    return this.promotionsService.getAdminRevenue();
  }
}
