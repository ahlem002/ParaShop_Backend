import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from '../clients/entities/client.entity';
import { Product } from '../products/entities/product.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Favorite } from './entities/favorite.entity';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

@Module({
  imports: [TypeOrmModule.forFeature([Favorite, Client, Product])],
  controllers: [FavoritesController],
  providers: [FavoritesService, RolesGuard],
  exports: [FavoritesService],
})
export class FavoritesModule {}
