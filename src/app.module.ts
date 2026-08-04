import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { ActivityModule } from './activity/activity.module';
import { User } from './users/entities/user.entity';
import { Client } from './clients/entities/client.entity';
import { Company } from './companies/entities/company.entity';
import { Category } from './categories/entities/category.entity';
import { AdminApproval } from './admin-approvals/entities/admin-approval.entity';
import { Product } from './products/entities/product.entity';
import { Notification } from './notifications/entities/notification.entity';
import { CartItem } from './cart/entities/cart-item.entity';
import { Order } from './orders/entities/order.entity';
import { OrderItem } from './orders/entities/order-item.entity';
import { ActivityLog } from './activity/entities/activity-log.entity';
import { Favorite } from './favorites/entities/favorite.entity';
import { NotificationsModule } from './notifications/notifications.module';
import { MailModule } from './mail/mail.module';
import { FavoritesModule } from './favorites/favorites.module';
import { CompanyStatsModule } from './company-stats/company-stats.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
  type: 'mysql',
  host: configService.get<string>('DB_HOST'),
  port: Number(configService.get('DB_PORT')),
  username: configService.get<string>('DB_USERNAME'),
  password: configService.get<string>('DB_PASSWORD'),
  database: configService.get<string>('DB_DATABASE'),

  entities: [
    User,
    Client,
    Company,
    Category,
    AdminApproval,
    Product,
    Notification,
    CartItem,
    Order,
    OrderItem,
    ActivityLog,
    Favorite,
  ],

  synchronize: configService.get<string>('DB_SYNC') === 'true',

  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
  },
}),
    }),
    TypeOrmModule.forFeature([Category]),
    AuthModule,
    AdminModule,
    CategoriesModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    ActivityModule,
    FavoritesModule,
    CompanyStatsModule,
    NotificationsModule,
    MailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnModuleInit {
  constructor(
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  async onModuleInit() {
    const defaultCategories = [
      'Medications',
      'Parapharmaceutical products',
      'Cosmetics',
      'Dietary supplements',
    ];

    const categoryMigrations: { from: string; to: string }[] = [
      { from: 'Médicaments', to: 'Medications' },
      { from: 'Parapharmacie', to: 'Parapharmaceutical products' },
      { from: 'Cosmétique', to: 'Cosmetics' },
      { from: 'Compléments alimentaires', to: 'Dietary supplements' },
      { from: 'Medicines', to: 'Medications' },
      { from: 'Parapharmacy', to: 'Parapharmaceutical products' },
      { from: 'Supplements', to: 'Dietary supplements' },
    ];

    for (const { from, to } of categoryMigrations) {
      const legacy = await this.categoriesRepository.findOne({
        where: { name: from },
      });
      if (!legacy) continue;

      const target = await this.categoriesRepository.findOne({
        where: { name: to },
      });
      if (target) {
        await this.categoriesRepository.remove(legacy);
      } else {
        legacy.name = to;
        await this.categoriesRepository.save(legacy);
      }
    }

    for (const name of defaultCategories) {
      const exists = await this.categoriesRepository.findOne({ where: { name } });
      if (!exists) {
        await this.categoriesRepository.save(
          this.categoriesRepository.create({ name }),
        );
      }
    }

    // Keep only the official product categories
    const all = await this.categoriesRepository.find({
      relations: { products: true },
    });
    for (const category of all) {
      if (defaultCategories.includes(category.name)) continue;
      if (category.products?.length) continue;
      await this.categoriesRepository.remove(category);
    }
  }
}
