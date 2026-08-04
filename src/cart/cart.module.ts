import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartItem } from './entities/cart-item.entity';
import { Client } from '../clients/entities/client.entity';
import { Product } from '../products/entities/product.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ActivityModule } from '../activity/activity.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CartItem, Client, Product]),
    ActivityModule,
  ],
  controllers: [CartController],
  providers: [CartService, RolesGuard],
  exports: [CartService],
})
export class CartModule {}
