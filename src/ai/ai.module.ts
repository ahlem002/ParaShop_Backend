import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
