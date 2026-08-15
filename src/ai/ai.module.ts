import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { PromotionsModule } from '../promotions/promotions.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product]), PromotionsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
