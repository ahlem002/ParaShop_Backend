import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Company } from '../companies/entities/company.entity';
import { Category } from '../categories/entities/category.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApprovedCompanyGuard } from '../auth/guards/approved-company.guard';
import { ProductsController } from './products.controller';
import { PublicProductsController } from './public-products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Company, Category])],
  controllers: [ProductsController, PublicProductsController],
  providers: [ProductsService, RolesGuard, ApprovedCompanyGuard],
  exports: [ProductsService],
})
export class ProductsModule {}
