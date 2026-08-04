import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/entities/company.entity';
import { Product } from '../products/entities/product.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Favorite } from '../favorites/entities/favorite.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApprovedCompanyGuard } from '../auth/guards/approved-company.guard';
import { CompanyStatsController } from './company-stats.controller';
import { CompanyStatsService } from './company-stats.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Company,
      Product,
      Order,
      OrderItem,
      CartItem,
      Favorite,
    ]),
  ],
  controllers: [CompanyStatsController],
  providers: [CompanyStatsService, RolesGuard, ApprovedCompanyGuard],
})
export class CompanyStatsModule {}
