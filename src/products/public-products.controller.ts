import { Controller, Get, Param } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class PublicProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findApproved() {
    return this.productsService.findApprovedPublic();
  }

  @Get(':productId')
  findOne(@Param('productId') productId: string) {
    return this.productsService.findOneApprovedPublic(productId);
  }
}
