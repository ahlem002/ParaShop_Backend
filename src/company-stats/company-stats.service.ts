import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { Company } from '../companies/entities/company.entity';
import { Product } from '../products/entities/product.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Favorite } from '../favorites/entities/favorite.entity';
import { VerificationStatus } from '../common/enums/verification-status.enum';
import { OrderStatus } from '../common/enums/order-status.enum';

const LOW_STOCK_THRESHOLD = 5;

const PAID_STATUSES = [
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
] as const;

export type CompanyDashboardStats = {
  products: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    inStock: number;
    outOfStock: number;
    lowStock: number;
  };
  inventory: {
    totalStockUnits: number;
    catalogValue: number;
  };
  sales: {
    paidOrders: number;
    unitsSold: number;
    revenue: number;
    revenueThisMonth: number;
  };
  engagement: {
    favorites: number;
    inCarts: number;
    cartUnits: number;
  };
  outOfStockProducts: Array<{
    productId: string;
    name: string;
    stock: number;
    verificationStatus: VerificationStatus;
    price: number;
  }>;
  lowStockProducts: Array<{
    productId: string;
    name: string;
    stock: number;
    verificationStatus: VerificationStatus;
    price: number;
  }>;
  topSelling: Array<{
    productId: string;
    name: string;
    unitsSold: number;
    revenue: number;
  }>;
  mostFavorited: Array<{
    productId: string;
    name: string;
    favorites: number;
  }>;
  mostInCart: Array<{
    productId: string;
    name: string;
    cartEntries: number;
    cartUnits: number;
  }>;
  charts: {
    salesLast7Days: Array<{
      date: string;
      label: string;
      revenue: number;
      units: number;
      orders: number;
    }>;
    favoritesLast7Days: Array<{
      date: string;
      label: string;
      favorites: number;
    }>;
    stockLevels: Array<{
      productId: string;
      name: string;
      stock: number;
    }>;
  };
};

@Injectable()
export class CompanyStatsService {
  constructor(
    @InjectRepository(Company)
    private readonly companiesRepository: Repository<Company>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(CartItem)
    private readonly cartItemsRepository: Repository<CartItem>,
    @InjectRepository(Favorite)
    private readonly favoritesRepository: Repository<Favorite>,
  ) {}

  async getDashboardStats(userId: string): Promise<CompanyDashboardStats> {
    const company = await this.getCompanyForUser(userId);
    const companyId = company.companyId;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      totalProducts,
      pendingProducts,
      approvedProducts,
      rejectedProducts,
      outOfStockCount,
      lowStockOnly,
      inStockCount,
      catalogProducts,
      paidOrders,
      salesAgg,
      monthSalesAgg,
      favoritesCount,
      cartAgg,
      outOfStockProducts,
      lowStockProducts,
      topSellingRaw,
      mostFavoritedRaw,
      mostInCartRaw,
      recentPaidOrders,
      recentFavorites,
      stockLevelProducts,
    ] = await Promise.all([
      this.productsRepository.count({ where: { companyId } }),
      this.productsRepository.count({
        where: { companyId, verificationStatus: VerificationStatus.PENDING },
      }),
      this.productsRepository.count({
        where: { companyId, verificationStatus: VerificationStatus.APPROVED },
      }),
      this.productsRepository.count({
        where: { companyId, verificationStatus: VerificationStatus.REJECTED },
      }),
      this.productsRepository.count({ where: { companyId, stock: 0 } }),
      this.productsRepository
        .createQueryBuilder('product')
        .where('product.companyId = :companyId', { companyId })
        .andWhere('product.stock > 0')
        .andWhere('product.stock <= :threshold', {
          threshold: LOW_STOCK_THRESHOLD,
        })
        .getCount(),
      this.productsRepository.count({
        where: { companyId, stock: MoreThan(0) },
      }),
      this.productsRepository.find({
        where: {
          companyId,
          verificationStatus: VerificationStatus.APPROVED,
        },
        select: { productId: true, price: true, stock: true },
      }),
      this.ordersRepository.count({
        where: {
          companyId,
          status: In([...PAID_STATUSES]),
          paidAt: Not(IsNull()),
        },
      }),
      this.orderItemsRepository
        .createQueryBuilder('item')
        .innerJoin('item.order', 'ord')
        .select('COALESCE(SUM(item.quantity), 0)', 'unitsSold')
        .addSelect('COALESCE(SUM(item.lineTotal), 0)', 'revenue')
        .where('ord.companyId = :companyId', { companyId })
        .andWhere('ord.status IN (:...statuses)', {
          statuses: [...PAID_STATUSES],
        })
        .andWhere('ord.paidAt IS NOT NULL')
        .getRawOne<{ unitsSold: string; revenue: string }>(),
      this.orderItemsRepository
        .createQueryBuilder('item')
        .innerJoin('item.order', 'ord')
        .select('COALESCE(SUM(item.lineTotal), 0)', 'revenue')
        .where('ord.companyId = :companyId', { companyId })
        .andWhere('ord.status IN (:...statuses)', {
          statuses: [...PAID_STATUSES],
        })
        .andWhere('ord.paidAt IS NOT NULL')
        .andWhere('ord.paidAt >= :monthStart', { monthStart })
        .getRawOne<{ revenue: string }>(),
      this.favoritesRepository
        .createQueryBuilder('fav')
        .innerJoin('fav.product', 'product')
        .where('product.companyId = :companyId', { companyId })
        .getCount(),
      this.cartItemsRepository
        .createQueryBuilder('cart')
        .innerJoin('cart.product', 'product')
        .select('COUNT(cart.cartItemId)', 'inCarts')
        .addSelect('COALESCE(SUM(cart.quantity), 0)', 'cartUnits')
        .where('product.companyId = :companyId', { companyId })
        .getRawOne<{ inCarts: string; cartUnits: string }>(),
      this.productsRepository.find({
        where: { companyId, stock: 0 },
        select: {
          productId: true,
          name: true,
          stock: true,
          verificationStatus: true,
          price: true,
        },
        order: { updatedAt: 'DESC' },
        take: 10,
      }),
      this.productsRepository
        .createQueryBuilder('product')
        .select([
          'product.productId',
          'product.name',
          'product.stock',
          'product.verificationStatus',
          'product.price',
        ])
        .where('product.companyId = :companyId', { companyId })
        .andWhere('product.stock > 0')
        .andWhere('product.stock <= :threshold', {
          threshold: LOW_STOCK_THRESHOLD,
        })
        .orderBy('product.stock', 'ASC')
        .take(10)
        .getMany(),
      this.orderItemsRepository
        .createQueryBuilder('item')
        .innerJoin('item.order', 'ord')
        .select('item.productId', 'productId')
        .addSelect('item.productName', 'name')
        .addSelect('SUM(item.quantity)', 'unitsSold')
        .addSelect('SUM(item.lineTotal)', 'revenue')
        .where('ord.companyId = :companyId', { companyId })
        .andWhere('ord.status IN (:...statuses)', {
          statuses: [...PAID_STATUSES],
        })
        .andWhere('ord.paidAt IS NOT NULL')
        .groupBy('item.productId')
        .addGroupBy('item.productName')
        .orderBy('unitsSold', 'DESC')
        .limit(5)
        .getRawMany<{
          productId: string;
          name: string;
          unitsSold: string;
          revenue: string;
        }>(),
      this.favoritesRepository
        .createQueryBuilder('fav')
        .innerJoin('fav.product', 'product')
        .select('product.productId', 'productId')
        .addSelect('product.name', 'name')
        .addSelect('COUNT(fav.favoriteId)', 'favorites')
        .where('product.companyId = :companyId', { companyId })
        .groupBy('product.productId')
        .addGroupBy('product.name')
        .orderBy('favorites', 'DESC')
        .limit(5)
        .getRawMany<{
          productId: string;
          name: string;
          favorites: string;
        }>(),
      this.cartItemsRepository
        .createQueryBuilder('cart')
        .innerJoin('cart.product', 'product')
        .select('product.productId', 'productId')
        .addSelect('product.name', 'name')
        .addSelect('COUNT(cart.cartItemId)', 'cartEntries')
        .addSelect('COALESCE(SUM(cart.quantity), 0)', 'cartUnits')
        .where('product.companyId = :companyId', { companyId })
        .groupBy('product.productId')
        .addGroupBy('product.name')
        .orderBy('cartUnits', 'DESC')
        .limit(5)
        .getRawMany<{
          productId: string;
          name: string;
          cartEntries: string;
          cartUnits: string;
        }>(),
      this.ordersRepository.find({
        where: {
          companyId,
          status: In([...PAID_STATUSES]),
          paidAt: MoreThanOrEqual(this.daysAgo(6)),
        },
        relations: { items: true },
      }),
      this.favoritesRepository
        .createQueryBuilder('fav')
        .innerJoin('fav.product', 'product')
        .where('product.companyId = :companyId', { companyId })
        .andWhere('fav.createdAt >= :from', { from: this.daysAgo(6) })
        .getMany(),
      this.productsRepository.find({
        where: { companyId },
        select: { productId: true, name: true, stock: true },
        order: { stock: 'ASC' },
        take: 8,
      }),
    ]);

    const catalogValue = catalogProducts.reduce(
      (sum, product) => sum + Number(product.price) * Number(product.stock),
      0,
    );
    const totalStockUnits = catalogProducts.reduce(
      (sum, product) => sum + Number(product.stock),
      0,
    );

    return {
      products: {
        total: totalProducts,
        pending: pendingProducts,
        approved: approvedProducts,
        rejected: rejectedProducts,
        inStock: inStockCount,
        outOfStock: outOfStockCount,
        lowStock: lowStockOnly,
      },
      inventory: {
        totalStockUnits,
        catalogValue: Math.round(catalogValue * 100) / 100,
      },
      sales: {
        paidOrders,
        unitsSold: Number(salesAgg?.unitsSold ?? 0),
        revenue: Math.round(Number(salesAgg?.revenue ?? 0) * 100) / 100,
        revenueThisMonth:
          Math.round(Number(monthSalesAgg?.revenue ?? 0) * 100) / 100,
      },
      engagement: {
        favorites: favoritesCount,
        inCarts: Number(cartAgg?.inCarts ?? 0),
        cartUnits: Number(cartAgg?.cartUnits ?? 0),
      },
      outOfStockProducts: outOfStockProducts.map((p) => ({
        productId: p.productId,
        name: p.name,
        stock: p.stock,
        verificationStatus: p.verificationStatus,
        price: Number(p.price),
      })),
      lowStockProducts: lowStockProducts.map((p) => ({
        productId: p.productId,
        name: p.name,
        stock: p.stock,
        verificationStatus: p.verificationStatus,
        price: Number(p.price),
      })),
      topSelling: topSellingRaw.map((row) => ({
        productId: row.productId,
        name: row.name,
        unitsSold: Number(row.unitsSold),
        revenue: Math.round(Number(row.revenue) * 100) / 100,
      })),
      mostFavorited: mostFavoritedRaw.map((row) => ({
        productId: row.productId,
        name: row.name,
        favorites: Number(row.favorites),
      })),
      mostInCart: mostInCartRaw.map((row) => ({
        productId: row.productId,
        name: row.name,
        cartEntries: Number(row.cartEntries),
        cartUnits: Number(row.cartUnits),
      })),
      charts: {
        salesLast7Days: this.buildSalesLast7Days(recentPaidOrders),
        favoritesLast7Days: this.buildFavoritesLast7Days(recentFavorites),
        stockLevels: stockLevelProducts.map((p) => ({
          productId: p.productId,
          name: this.shortName(p.name),
          stock: Number(p.stock),
        })),
      },
    };
  }

  private daysAgo(days: number) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - days);
    return date;
  }

  private shortName(name: string, max = 18) {
    const trimmed = name.trim();
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max - 1)}…`;
  }

  private emptyLast7Days<T extends Record<string, number>>(extra: T) {
    const days: Array<{ date: string; label: string } & T> = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - i);
      days.push({
        date: day.toISOString().slice(0, 10),
        label: day.toLocaleDateString('en-GB', {
          weekday: 'short',
          day: '2-digit',
        }),
        ...extra,
      });
    }
    return days;
  }

  private buildSalesLast7Days(
    orders: Array<{
      paidAt: Date | null;
      total: number;
      items: Array<{ quantity: number }>;
    }>,
  ) {
    const days = this.emptyLast7Days({ revenue: 0, units: 0, orders: 0 });
    const indexByKey = new Map(days.map((day, index) => [day.date, index]));

    for (const order of orders) {
      if (!order.paidAt) continue;
      const key = new Date(order.paidAt).toISOString().slice(0, 10);
      const index = indexByKey.get(key);
      if (index === undefined) continue;
      days[index].orders += 1;
      days[index].revenue += Number(order.total);
      days[index].units += order.items.reduce(
        (sum, item) => sum + Number(item.quantity),
        0,
      );
    }

    return days.map((day) => ({
      ...day,
      revenue: Math.round(day.revenue * 100) / 100,
    }));
  }

  private buildFavoritesLast7Days(favorites: Array<{ createdAt: Date }>) {
    const days = this.emptyLast7Days({ favorites: 0 });
    const indexByKey = new Map(days.map((day, index) => [day.date, index]));

    for (const fav of favorites) {
      const key = new Date(fav.createdAt).toISOString().slice(0, 10);
      const index = indexByKey.get(key);
      if (index === undefined) continue;
      days[index].favorites += 1;
    }

    return days;
  }

  private async getCompanyForUser(userId: string) {
    const company = await this.companiesRepository.findOne({
      where: { userId },
    });
    if (!company) {
      throw new ForbiddenException('Company account not found');
    }
    return company;
  }
}
