import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Client } from '../clients/entities/client.entity';
import { Company } from '../companies/entities/company.entity';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActivityModule } from '../activity/activity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CompanyOrdersController } from './company-orders.controller';
import { DeliveryOrdersController } from './delivery-orders.controller';
import { DeliveryRating } from './entities/delivery-rating.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { FlouciService } from './flouci.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      DeliveryRating,
      CartItem,
      Client,
      Company,
      Product,
      User,
    ]),
    ActivityModule,
    NotificationsModule,
  ],
  controllers: [
    OrdersController,
    CompanyOrdersController,
    DeliveryOrdersController,
  ],
  providers: [OrdersService, FlouciService, RolesGuard],
  exports: [OrdersService],
})
export class OrdersModule {}
