import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/entities/company.entity';
import { Product } from '../products/entities/product.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminPromotionsController } from './admin-promotions.controller';
import { CompanyPromotionsController } from './company-promotions.controller';
import { PromotionCampaign } from './entities/promotion-campaign.entity';
import { PromotionCampaignProduct } from './entities/promotion-campaign-product.entity';
import { PromotionOffer } from './entities/promotion-offer.entity';
import { PromotionPriceOverride } from './entities/promotion-price-override.entity';
import { PromotionsService } from './promotions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PromotionOffer,
      PromotionPriceOverride,
      PromotionCampaign,
      PromotionCampaignProduct,
      Product,
      Company,
    ]),
  ],
  controllers: [AdminPromotionsController, CompanyPromotionsController],
  providers: [PromotionsService, RolesGuard],
  exports: [PromotionsService],
})
export class PromotionsModule {}
