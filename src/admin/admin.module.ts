import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from '../clients/entities/client.entity';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { AdminApproval } from '../admin-approvals/entities/admin-approval.entity';
import { Product } from '../products/entities/product.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Client, Company, User, AdminApproval, Product]),
    NotificationsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, RolesGuard],
})
export class AdminModule {}
