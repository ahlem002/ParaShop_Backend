import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApprovedCompanyGuard } from '../auth/guards/approved-company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  CreatePromotionCampaignDto,
  QuotePromotionDto,
} from './dto/promotion.dto';
import { PromotionsService } from './promotions.service';

@Controller('company/promotions')
@UseGuards(AuthGuard('jwt'), RolesGuard, ApprovedCompanyGuard)
@Roles(Role.COMPANY)
export class CompanyPromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get('offers')
  listOffers() {
    return this.promotionsService.listOffers();
  }

  @Post('quote')
  quote(@Body() dto: QuotePromotionDto) {
    return this.promotionsService.quotePrice(dto.offerType, dto.productIds);
  }

  @Get('campaigns')
  listMine(@CurrentUser() user: JwtPayload) {
    return this.promotionsService.listCompanyCampaigns(user.sub);
  }

  @Post('campaigns')
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePromotionCampaignDto,
  ) {
    return this.promotionsService.createCompanyCampaign(user.sub, dto);
  }

  @Post('campaigns/:campaignId/confirm-payment')
  confirmPayment(
    @CurrentUser() user: JwtPayload,
    @Param('campaignId') campaignId: string,
  ) {
    return this.promotionsService.confirmCampaignPayment(user.sub, campaignId);
  }

  @Post('campaigns/:campaignId/cancel')
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('campaignId') campaignId: string,
  ) {
    return this.promotionsService.cancelCompanyCampaign(user.sub, campaignId);
  }
}
