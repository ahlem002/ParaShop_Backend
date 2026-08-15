import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Client } from '../clients/entities/client.entity';
import { Company } from '../companies/entities/company.entity';
import { ActivityType } from '../common/enums/activity-type.enum';
import { OrderStatus } from '../common/enums/order-status.enum';
import { VerificationStatus } from '../common/enums/verification-status.enum';
import { ActivityService } from '../activity/activity.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { BuyNowDto } from './dto/buy-now.dto';
import { CheckoutDto } from './dto/checkout.dto';
import {
  COMPANY_UPDATABLE_STATUSES,
  type CompanyUpdatableStatus,
} from './dto/update-order-status.dto';
import type { DeliveryUpdatableStatus } from './dto/update-delivery-order-status.dto';
import { DeliveryRating } from './entities/delivery-rating.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { FlouciService } from './flouci.service';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { ProductsService } from '../products/products.service';

const COMPANY_STATUS_FLOW: Record<
  CompanyUpdatableStatus,
  OrderStatus[]
> = {
  [OrderStatus.PROCESSING]: [OrderStatus.PAID],
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(CartItem)
    private readonly cartItemsRepository: Repository<CartItem>,
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(Company)
    private readonly companiesRepository: Repository<Company>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(DeliveryRating)
    private readonly deliveryRatingsRepository: Repository<DeliveryRating>,
    private readonly flouciService: FlouciService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly activityService: ActivityService,
    private readonly notificationsService: NotificationsService,
    private readonly productsService: ProductsService,
  ) {}

  async checkout(userId: string, dto: CheckoutDto) {
    const client = await this.getClientForUser(userId);
    const user = await this.usersRepository.findOne({ where: { userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const company = await this.companiesRepository.findOne({
      where: { companyId: dto.companyId },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    const cartItems = await this.cartItemsRepository.find({
      where: { clientId: client.clientId },
      relations: { product: true },
    });

    const companyItems = cartItems.filter(
      (item) => item.product?.companyId === dto.companyId,
    );

    if (companyItems.length === 0) {
      throw new BadRequestException(
        'No cart items found for this company. Add products before checkout.',
      );
    }

    for (const item of companyItems) {
      if (
        !item.product ||
        item.product.verificationStatus !== VerificationStatus.APPROVED
      ) {
        throw new BadRequestException(
          `Product "${item.product?.name ?? item.productId}" is not available`,
        );
      }
      if (item.quantity > item.product.stock) {
        throw new BadRequestException(
          `Not enough stock for "${item.product.name}" (available: ${item.product.stock})`,
        );
      }
    }

    const subtotal = companyItems.reduce(
      (sum, item) => sum + Number(item.product.price) * item.quantity,
      0,
    );
    const deliveryFee = Number(company.deliveryFee ?? 0);
    const total = Number((subtotal + deliveryFee).toFixed(2));
    const amountMillimes = Math.round(total * 1000);

    if (amountMillimes < 100) {
      throw new BadRequestException('Order total is too low for payment');
    }

    const trackingId = `ps_${randomUUID().replace(/-/g, '')}`;
    const notes = dto.notes?.trim();
    const shippingAddress = notes
      ? `${dto.shippingAddress.trim()}\n\nNotes: ${notes}`
      : dto.shippingAddress.trim();
    const shippingPhone = dto.phoneNumber.trim();

    const order = await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(Order);
      const itemRepo = manager.getRepository(OrderItem);

      const created = orderRepo.create({
        clientId: client.clientId,
        companyId: company.companyId,
        status: OrderStatus.PENDING_PAYMENT,
        subtotal: Number(subtotal.toFixed(2)),
        deliveryFee,
        total,
        amountMillimes,
        flouciPaymentId: null,
        trackingId,
        shippingAddress,
        shippingPhone,
        paidAt: null,
      });
      const savedOrder = await orderRepo.save(created);

      const lines = companyItems.map((item) =>
        itemRepo.create({
          orderId: savedOrder.orderId,
          productId: item.product.productId,
          productName: item.product.name,
          productImage: item.product.images?.[0] ?? null,
          unitPrice: Number(item.product.price),
          quantity: item.quantity,
          lineTotal: Number(
            (Number(item.product.price) * item.quantity).toFixed(2),
          ),
        }),
      );
      await itemRepo.save(lines);

      return savedOrder;
    });

    await this.activityService.log({
      userId,
      type: ActivityType.CHECKOUT_STARTED,
      title: 'Checkout started',
      message: `Started checkout with ${company.companyName} for ${total.toFixed(2)} TND`,
      metadata: {
        orderId: order.orderId,
        companyId: company.companyId,
        companyName: company.companyName,
        total,
        itemCount: companyItems.length,
      },
    });

    return this.toCheckoutSession(order, company);
  }

  async buyNow(userId: string, dto: BuyNowDto) {
    const client = await this.getClientForUser(userId);
    const product = await this.productsRepository.findOne({
      where: { productId: dto.productId },
      relations: { company: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.verificationStatus !== VerificationStatus.APPROVED) {
      throw new BadRequestException('Product is not available');
    }

    if (dto.quantity > product.stock) {
      throw new BadRequestException(
        `Not enough stock for "${product.name}" (available: ${product.stock})`,
      );
    }

    const company = product.company;
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    const unitPrice = Number(product.price);
    const subtotal = Number((unitPrice * dto.quantity).toFixed(2));
    const deliveryFee = Number(company.deliveryFee ?? 0);
    const total = Number((subtotal + deliveryFee).toFixed(2));
    const amountMillimes = Math.round(total * 1000);

    if (amountMillimes < 100) {
      throw new BadRequestException('Order total is too low for payment');
    }

    const trackingId = `ps_${randomUUID().replace(/-/g, '')}`;
    const notes = dto.notes?.trim();
    const shippingAddress = notes
      ? `${dto.shippingAddress.trim()}\n\nNotes: ${notes}`
      : dto.shippingAddress.trim();
    const shippingPhone = dto.phoneNumber.trim();

    const order = await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(Order);
      const itemRepo = manager.getRepository(OrderItem);

      const created = orderRepo.create({
        clientId: client.clientId,
        companyId: company.companyId,
        status: OrderStatus.PENDING_PAYMENT,
        subtotal,
        deliveryFee,
        total,
        amountMillimes,
        flouciPaymentId: null,
        trackingId,
        shippingAddress,
        shippingPhone,
        paidAt: null,
      });
      const savedOrder = await orderRepo.save(created);

      await itemRepo.save(
        itemRepo.create({
          orderId: savedOrder.orderId,
          productId: product.productId,
          productName: product.name,
          productImage: product.images?.[0] ?? null,
          unitPrice,
          quantity: dto.quantity,
          lineTotal: subtotal,
        }),
      );

      return savedOrder;
    });

    await this.activityService.log({
      userId,
      type: ActivityType.CHECKOUT_STARTED,
      title: 'Checkout started',
      message: `Started buy-now checkout for "${product.name}" (${total.toFixed(2)} TND)`,
      metadata: {
        orderId: order.orderId,
        companyId: company.companyId,
        companyName: company.companyName,
        productId: product.productId,
        total,
        quantity: dto.quantity,
      },
    });

    return this.toCheckoutSession(order, company);
  }

  async confirmFakePayment(userId: string, orderId: string) {
    const client = await this.getClientForUser(userId);
    const order = await this.ordersRepository.findOne({
      where: { orderId, clientId: client.clientId },
      relations: { items: { product: true }, company: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status === OrderStatus.PAID) {
      return this.toOrderView(order);
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        `Order cannot be paid in status ${order.status}`,
      );
    }

    await this.markOrderPaid(order);

    const refreshed = await this.ordersRepository.findOne({
      where: { orderId: order.orderId },
      relations: { company: true, items: { product: true } },
    });

    await this.backfillMissingItemImages(refreshed?.items ?? []);

    return {
      ...this.toOrderView(refreshed!),
      paymentVerified: true,
      paymentStatus: 'SUCCESS',
    };
  }

  private toCheckoutSession(order: Order, company: Company) {
    return {
      orderId: order.orderId,
      trackingId: order.trackingId,
      total: Number(order.total),
      amountMillimes: order.amountMillimes,
      paymentId: null as string | null,
      paymentUrl: null as string | null,
      company: {
        companyId: company.companyId,
        companyName: company.companyName,
      },
    };
  }

  async listMyOrders(userId: string) {
    const client = await this.getClientForUser(userId);
    const orders = await this.ordersRepository.find({
      where: { clientId: client.clientId },
      relations: { company: true, items: { product: true }, deliveryUser: true },
      order: { createdAt: 'DESC' },
    });

    await this.backfillMissingItemImages(orders.flatMap((o) => o.items ?? []));

    const ratings = await this.deliveryRatingsRepository.find({
      where: { clientId: client.clientId },
    });
    const ratedOrderIds = new Set(ratings.map((item) => item.orderId));

    return orders.map((order) => ({
      ...this.toOrderView(order),
      canRateDelivery:
        order.status === OrderStatus.DELIVERED &&
        Boolean(order.deliveryUserId) &&
        !ratedOrderIds.has(order.orderId),
      myDeliveryRating: ratings.find((item) => item.orderId === order.orderId)
        ? {
            rating: ratings.find((item) => item.orderId === order.orderId)!.rating,
            comment:
              ratings.find((item) => item.orderId === order.orderId)!.comment,
          }
        : null,
    }));
  }

  async listCompanyOrders(userId: string) {
    const company = await this.getCompanyForUser(userId);
    const orders = await this.ordersRepository.find({
      where: { companyId: company.companyId },
      relations: {
        company: true,
        items: { product: true },
        client: { user: true },
        deliveryUser: true,
      },
      order: { createdAt: 'DESC' },
    });

    await this.backfillMissingItemImages(orders.flatMap((o) => o.items ?? []));

    return orders.map((order) => this.toCompanyOrderView(order));
  }

  async getCompanyOrder(userId: string, orderId: string) {
    const company = await this.getCompanyForUser(userId);
    const order = await this.ordersRepository.findOne({
      where: { orderId, companyId: company.companyId },
      relations: {
        company: true,
        items: { product: true },
        client: { user: true },
        deliveryUser: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.backfillMissingItemImages(order.items ?? []);

    return this.toCompanyOrderView(order);
  }

  async listAvailableDrivers(freeOnly = false) {
    const drivers = await this.usersRepository.find({
      where: {
        role: Role.DELIVERY,
        status: UserStatus.ACTIVE,
        profileCompleted: true,
        mustChangePassword: false,
      },
      order: { firstName: 'ASC', lastName: 'ASC' },
    });

    const active = await this.ordersRepository.find({
      where: { status: OrderStatus.SHIPPED },
    });
    const busyIds = new Set(
      active
        .map((order) => order.deliveryUserId)
        .filter((id): id is string => Boolean(id)),
    );

    const filtered = freeOnly
      ? drivers.filter((driver) => !busyIds.has(driver.userId))
      : drivers;

    const ratings = await this.deliveryRatingsRepository.find({
      where: { deliveryUserId: In(filtered.map((d) => d.userId)) },
      order: { createdAt: 'DESC' },
    });

    return filtered.map((driver) => {
      const driverRatings = ratings.filter(
        (rating) => rating.deliveryUserId === driver.userId,
      );
      const averageRating =
        driverRatings.length > 0
          ? Number(
              (
                driverRatings.reduce((sum, item) => sum + item.rating, 0) /
                driverRatings.length
              ).toFixed(2),
            )
          : null;

      return {
        userId: driver.userId,
        firstName: driver.firstName,
        lastName: driver.lastName,
        email: driver.email,
        phoneNumber: driver.phoneNumber,
        isFree: !busyIds.has(driver.userId),
        averageRating,
        ratingCount: driverRatings.length,
        recentNotes: driverRatings
          .filter((item) => item.comment)
          .slice(0, 5)
          .map((item) => ({
            rating: item.rating,
            comment: item.comment,
            createdAt: item.createdAt,
          })),
      };
    });
  }

  async assignDriverToOrder(
    userId: string,
    orderId: string,
    deliveryUserId: string,
  ) {
    const company = await this.getCompanyForUser(userId);
    const order = await this.ordersRepository.findOne({
      where: { orderId, companyId: company.companyId },
      relations: {
        company: true,
        items: { product: true },
        client: { user: true },
        deliveryUser: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== OrderStatus.PROCESSING) {
      throw new BadRequestException(
        'Only processing orders can be assigned to a driver',
      );
    }

    const driver = await this.usersRepository.findOne({
      where: {
        userId: deliveryUserId,
        role: Role.DELIVERY,
        status: UserStatus.ACTIVE,
      },
    });

    if (!driver) {
      throw new NotFoundException('Delivery driver not found');
    }

    if (driver.mustChangePassword || !driver.profileCompleted) {
      throw new BadRequestException(
        'This driver has not finished account setup yet',
      );
    }

    order.deliveryUserId = driver.userId;
    order.deliveryUser = driver;
    order.status = OrderStatus.SHIPPED;
    await this.ordersRepository.save(order);

    await this.activityService.log({
      userId,
      type: ActivityType.ORDER_STATUS_UPDATED,
      title: 'Driver assigned',
      message: `Order ${order.orderId.slice(0, 8)}… assigned to ${driver.firstName} ${driver.lastName}`,
      metadata: {
        orderId: order.orderId,
        status: OrderStatus.SHIPPED,
        deliveryUserId: driver.userId,
      },
    });

    void this.notificationsService.createForUser({
      userId: driver.userId,
      type: NotificationType.DELIVERY_ASSIGNED,
      title: 'New delivery assigned',
      message: `You have a new delivery from ${company.companyName}.`,
      link: '/delivery/orders',
      relatedId: order.orderId,
    });

    const clientUserId = order.client?.userId ?? order.client?.user?.userId;
    if (clientUserId) {
      void this.notificationsService.createForUser({
        userId: clientUserId,
        type: NotificationType.ORDER_UPDATED,
        title: 'Order update',
        message: `Your order from ${company.companyName} is now shipped.`,
        link: '/orders',
        relatedId: order.orderId,
      });
    }

    await this.backfillMissingItemImages(order.items ?? []);
    return this.toCompanyOrderView(order);
  }

  async listDeliveryOrders(
    userId: string,
    scope: 'active' | 'history' | 'all' = 'all',
  ) {
    const where =
      scope === 'active'
        ? { deliveryUserId: userId, status: OrderStatus.SHIPPED }
        : scope === 'history'
          ? {
              deliveryUserId: userId,
              status: In([OrderStatus.DELIVERED, OrderStatus.RETURNED]),
            }
          : { deliveryUserId: userId };

    const orders = await this.ordersRepository.find({
      where,
      relations: {
        company: true,
        items: { product: true },
        client: { user: true },
        deliveryUser: true,
      },
      order: { updatedAt: 'DESC' },
    });

    await this.backfillMissingItemImages(orders.flatMap((o) => o.items ?? []));
    return orders.map((order) => this.toDeliveryOrderView(order));
  }

  async getDeliveryOrder(userId: string, orderId: string) {
    const order = await this.ordersRepository.findOne({
      where: { orderId, deliveryUserId: userId },
      relations: {
        company: true,
        items: { product: true },
        client: { user: true },
        deliveryUser: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.backfillMissingItemImages(order.items ?? []);
    return this.toDeliveryOrderView(order);
  }

  async updateDeliveryOrderStatus(
    userId: string,
    orderId: string,
    nextStatus: DeliveryUpdatableStatus,
    note?: string,
  ) {
    const order = await this.ordersRepository.findOne({
      where: { orderId, deliveryUserId: userId },
      relations: {
        company: { user: true },
        items: { product: true },
        client: { user: true },
        deliveryUser: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== OrderStatus.SHIPPED) {
      throw new BadRequestException(
        'Only shipped orders can be marked delivered or returned',
      );
    }

    if (nextStatus === OrderStatus.RETURNED) {
      const trimmed = note?.trim() ?? '';
      if (trimmed.length < 3) {
        throw new BadRequestException(
          'A note is required when returning an order (e.g. client refused)',
        );
      }
      order.deliveryNote = trimmed;
      order.returnedAt = new Date();
      order.deliveredAt = null;
    } else {
      order.deliveryNote = note?.trim() || null;
      order.deliveredAt = new Date();
      order.returnedAt = null;
    }

    order.status = nextStatus;
    await this.ordersRepository.save(order);

    await this.activityService.log({
      userId,
      type: ActivityType.ORDER_STATUS_UPDATED,
      title: 'Delivery status updated',
      message: `Order ${order.orderId.slice(0, 8)}… → ${nextStatus}`,
      metadata: {
        orderId: order.orderId,
        status: nextStatus,
        note: order.deliveryNote,
      },
    });

    const clientUserId = order.client?.userId ?? order.client?.user?.userId;
    if (clientUserId) {
      const statusLabel = this.statusLabel(nextStatus);
      void this.notificationsService.createForUser({
        userId: clientUserId,
        type: NotificationType.ORDER_UPDATED,
        title: 'Order update',
        message:
          nextStatus === OrderStatus.RETURNED
            ? `Your order from ${order.company.companyName} was returned to the seller.`
            : `Your order from ${order.company.companyName} is now ${statusLabel}.`,
        link: '/orders',
        relatedId: order.orderId,
      });
    }

    const companyUserId = order.company?.userId ?? order.company?.user?.userId;
    if (companyUserId) {
      void this.notificationsService.createForUser({
        userId: companyUserId,
        type: NotificationType.ORDER_UPDATED,
        title: 'Delivery update',
        message:
          nextStatus === OrderStatus.RETURNED
            ? `Order ${order.trackingId} was returned. Note: ${order.deliveryNote}`
            : `Order ${order.trackingId} was delivered.`,
        link: '/company/delivery',
        relatedId: order.orderId,
      });
    }

    await this.backfillMissingItemImages(order.items ?? []);
    return this.toDeliveryOrderView(order);
  }

  async rateDelivery(
    userId: string,
    orderId: string,
    rating: number,
    comment?: string,
  ) {
    const client = await this.getClientForUser(userId);
    const order = await this.ordersRepository.findOne({
      where: { orderId, clientId: client.clientId },
      relations: { deliveryUser: true, company: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException('You can only rate delivered orders');
    }

    if (!order.deliveryUserId) {
      throw new BadRequestException('No delivery driver was assigned');
    }

    const existing = await this.deliveryRatingsRepository.findOne({
      where: { orderId: order.orderId },
    });
    if (existing) {
      throw new BadRequestException('You already rated this delivery');
    }

    const saved = await this.deliveryRatingsRepository.save(
      this.deliveryRatingsRepository.create({
        orderId: order.orderId,
        deliveryUserId: order.deliveryUserId,
        clientId: client.clientId,
        rating,
        comment: comment?.trim() || null,
      }),
    );

    void this.notificationsService.createForUser({
      userId: order.deliveryUserId,
      type: NotificationType.DRIVER_RATED,
      title: 'New delivery rating',
      message: `A client rated your delivery ${rating}/5.`,
      link: '/delivery/orders',
      relatedId: order.orderId,
    });

    return {
      ratingId: saved.ratingId,
      orderId: saved.orderId,
      rating: saved.rating,
      comment: saved.comment,
      createdAt: saved.createdAt,
    };
  }

  async updateCompanyOrderStatus(
    userId: string,
    orderId: string,
    nextStatus: CompanyUpdatableStatus,
  ) {
    if (!COMPANY_UPDATABLE_STATUSES.includes(nextStatus)) {
      throw new BadRequestException(
        `Invalid status. Allowed: ${COMPANY_UPDATABLE_STATUSES.join(', ')}`,
      );
    }

    const company = await this.getCompanyForUser(userId);
    const order = await this.ordersRepository.findOne({
      where: { orderId, companyId: company.companyId },
      relations: {
        company: true,
        items: { product: true },
        client: { user: true },
        deliveryUser: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const allowedFrom = COMPANY_STATUS_FLOW[nextStatus];
    if (!allowedFrom.includes(order.status)) {
      throw new BadRequestException(
        `Cannot move order from ${order.status} to ${nextStatus}`,
      );
    }

    order.status = nextStatus;
    await this.ordersRepository.save(order);

    await this.activityService.log({
      userId,
      type: ActivityType.ORDER_STATUS_UPDATED,
      title: 'Order status updated',
      message: `Order ${order.orderId.slice(0, 8)}… → ${nextStatus}`,
      metadata: {
        orderId: order.orderId,
        status: nextStatus,
        total: Number(order.total),
      },
    });

    const clientUserId = order.client?.userId ?? order.client?.user?.userId;
    if (clientUserId) {
      const statusLabel = this.statusLabel(nextStatus);
      void this.notificationsService.createForUser({
        userId: clientUserId,
        type: NotificationType.ORDER_UPDATED,
        title: 'Order update',
        message: `Your order from ${company.companyName} is now ${statusLabel}.`,
        link: '/orders',
        relatedId: order.orderId,
      });
    }

    await this.backfillMissingItemImages(order.items ?? []);

    return this.toCompanyOrderView(order);
  }

  async getMyOrder(userId: string, orderId: string) {
    const client = await this.getClientForUser(userId);
    const order = await this.ordersRepository.findOne({
      where: { orderId, clientId: client.clientId },
      relations: { company: true, items: { product: true } },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.backfillMissingItemImages(order.items ?? []);

    return this.toOrderView(order);
  }

  /** Normalize product image list from entity / JSON quirks */
  private firstProductImage(
    images: string[] | string | null | undefined,
  ): string | null {
    if (!images) return null;

    let list: unknown = images;
    if (typeof images === 'string') {
      try {
        list = JSON.parse(images);
      } catch {
        const trimmed = images.trim();
        return trimmed || null;
      }
    }

    if (!Array.isArray(list) || list.length === 0) return null;
    const first = list[0];
    return typeof first === 'string' && first.trim() ? first.trim() : null;
  }

  private resolveItemImage(item: OrderItem): string | null {
    if (item.productImage?.trim()) {
      return item.productImage.trim();
    }
    return this.firstProductImage(item.product?.images);
  }

  /** Persist missing snapshots so older orders show the same images as cart */
  private async backfillMissingItemImages(items: OrderItem[]) {
    const toSave: OrderItem[] = [];

    for (const item of items) {
      if (item.productImage?.trim()) continue;
      const image = this.firstProductImage(item.product?.images);
      if (!image) continue;
      item.productImage = image;
      toSave.push(item);
    }

    if (!toSave.length) return;

    try {
      await this.orderItemsRepository.save(toSave);
    } catch {
      // Column may not exist yet if DB wasn't synced; still return images in API
    }
  }

  async deleteMyOrder(userId: string, orderId: string) {
    const client = await this.getClientForUser(userId);
    const order = await this.ordersRepository.findOne({
      where: { orderId, clientId: client.clientId },
      relations: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.ordersRepository.remove(order);
    return { success: true };
  }

  async cancelMyOrder(userId: string, orderId: string) {
    const client = await this.getClientForUser(userId);
    const order = await this.ordersRepository.findOne({
      where: { orderId, clientId: client.clientId },
      relations: { company: true, items: { product: true } },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Order is already cancelled');
    }

    if (
      order.status === OrderStatus.SHIPPED ||
      order.status === OrderStatus.DELIVERED ||
      order.status === OrderStatus.RETURNED
    ) {
      throw new BadRequestException(
        'Shipped, delivered, or returned orders cannot be cancelled',
      );
    }

    const shouldRestoreStock =
      order.status === OrderStatus.PAID ||
      order.status === OrderStatus.PROCESSING;

    const stockChanges: Array<{
      productId: string;
      previousStock: number;
      newStock: number;
    }> = [];

    await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(Order);
      const productRepo = manager.getRepository(Product);

      const locked = await orderRepo.findOne({
        where: { orderId: order.orderId },
        relations: { items: true },
      });
      if (!locked || locked.status === OrderStatus.CANCELLED) return;

      if (
        locked.status === OrderStatus.SHIPPED ||
        locked.status === OrderStatus.DELIVERED ||
        locked.status === OrderStatus.RETURNED
      ) {
        throw new BadRequestException(
          'Shipped, delivered, or returned orders cannot be cancelled',
        );
      }

      if (
        shouldRestoreStock ||
        locked.status === OrderStatus.PAID ||
        locked.status === OrderStatus.PROCESSING
      ) {
        for (const line of locked.items ?? []) {
          const product = await productRepo.findOne({
            where: { productId: line.productId },
          });
          if (!product) continue;
          const previousStock = Number(product.stock);
          product.stock = previousStock + line.quantity;
          if (product.stock > 0) {
            product.soldOutAt = null;
          }
          await productRepo.save(product);
          stockChanges.push({
            productId: product.productId,
            previousStock,
            newStock: Number(product.stock),
          });
        }
      }

      locked.status = OrderStatus.CANCELLED;
      await orderRepo.save(locked);
    });

    if (stockChanges.length) {
      void this.productsService.applyStockChangeEffects(stockChanges);
    }

    const refreshed = await this.ordersRepository.findOne({
      where: { orderId: order.orderId },
      relations: { company: true, items: { product: true } },
    });

    await this.backfillMissingItemImages(refreshed?.items ?? []);

    await this.activityService.log({
      userId,
      type: ActivityType.ORDER_CANCELLED,
      title: 'Order cancelled',
      message: `Cancelled order with ${order.company?.companyName ?? 'company'} (${Number(order.total).toFixed(2)} TND)`,
      metadata: {
        orderId: order.orderId,
        companyId: order.companyId,
        total: Number(order.total),
      },
    });

    return this.toOrderView(refreshed!);
  }

  async verifyAndConfirm(orderId: string, userId?: string) {
    const where = userId
      ? { orderId, clientId: (await this.getClientForUser(userId)).clientId }
      : { orderId };

    const order = await this.ordersRepository.findOne({
      where,
      relations: { items: { product: true }, company: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status === OrderStatus.PAID) {
      return this.toOrderView(order);
    }

    if (!order.flouciPaymentId) {
      throw new BadRequestException('Order has no Flouci payment session');
    }

    const verification = await this.flouciService.verifyPayment(
      order.flouciPaymentId,
    );

    if (!verification.success) {
      if (
        verification.status === 'FAILURE' ||
        verification.status === 'EXPIRED'
      ) {
        order.status = OrderStatus.PAYMENT_FAILED;
        await this.ordersRepository.save(order);

        const client = await this.clientsRepository.findOne({
          where: { clientId: order.clientId },
        });
        if (client) {
          await this.activityService.log({
            userId: client.userId,
            type: ActivityType.PAYMENT_FAILED,
            title: 'Payment failed',
            message: `Payment failed for order ${order.orderId.slice(0, 8)}…`,
            metadata: {
              orderId: order.orderId,
              paymentStatus: verification.status,
              total: Number(order.total),
            },
          });
        }
      }

      return {
        ...this.toOrderView(order),
        paymentVerified: false,
        paymentStatus: verification.status || 'UNKNOWN',
      };
    }

    await this.markOrderPaid(order);
    const refreshed = await this.ordersRepository.findOne({
      where: { orderId: order.orderId },
      relations: { company: true, items: { product: true } },
    });

    return {
      ...this.toOrderView(refreshed!),
      paymentVerified: true,
      paymentStatus: 'SUCCESS',
    };
  }

  async handleFlouciWebhook(body: Record<string, unknown>) {
    const paymentId =
      (body.payment_id as string | undefined) ||
      (body.paymentId as string | undefined) ||
      ((body.result as { payment_id?: string } | undefined)?.payment_id);

    if (!paymentId) {
      throw new BadRequestException('Missing payment_id in webhook');
    }

    const order = await this.ordersRepository.findOne({
      where: { flouciPaymentId: paymentId },
      relations: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found for payment');
    }

    if (order.status === OrderStatus.PAID) {
      return { ok: true, alreadyPaid: true };
    }

    const verification = await this.flouciService.verifyPayment(paymentId);
    if (!verification.success) {
      return { ok: true, paid: false, status: verification.status };
    }

    await this.markOrderPaid(order);
    return { ok: true, paid: true };
  }

  private async markOrderPaid(order: Order) {
    if (order.status === OrderStatus.PAID) return;

    let justPaid = false;

    const stockChanges: Array<{
      productId: string;
      previousStock: number;
      newStock: number;
    }> = [];

    await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(Order);
      const productRepo = manager.getRepository(Product);
      const cartRepo = manager.getRepository(CartItem);

      const locked = await orderRepo.findOne({
        where: { orderId: order.orderId },
        relations: { items: true, company: true },
      });
      if (!locked || locked.status === OrderStatus.PAID) return;

      for (const line of locked.items) {
        const product = await productRepo.findOne({
          where: { productId: line.productId },
        });
        if (!product) {
          throw new BadRequestException(
            `Product missing for order line ${line.orderItemId}`,
          );
        }
        if (product.stock < line.quantity) {
          throw new BadRequestException(
            `Insufficient stock for "${product.name}" after payment`,
          );
        }
        const previousStock = Number(product.stock);
        product.stock = previousStock - line.quantity;
        if (product.stock === 0 && !product.soldOutAt) {
          product.soldOutAt = new Date();
        }
        await productRepo.save(product);
        stockChanges.push({
          productId: product.productId,
          previousStock,
          newStock: Number(product.stock),
        });
      }

      locked.status = OrderStatus.PAID;
      locked.paidAt = new Date();
      await orderRepo.save(locked);
      justPaid = true;

      const cartItems = await cartRepo.find({
        where: { clientId: locked.clientId },
        relations: { product: true },
      });
      const toRemove = cartItems.filter(
        (item) => item.product?.companyId === locked.companyId,
      );
      if (toRemove.length) {
        await cartRepo.remove(toRemove);
      }
    });

    if (!justPaid) return;

    if (stockChanges.length) {
      void this.productsService.applyStockChangeEffects(stockChanges);
    }

    const client = await this.clientsRepository.findOne({
      where: { clientId: order.clientId },
    });
    if (!client) return;

    const companyName =
      order.company?.companyName ??
      (
        await this.companiesRepository.findOne({
          where: { companyId: order.companyId },
        })
      )?.companyName ??
      'company';

    await this.activityService.log({
      userId: client.userId,
      type: ActivityType.PAYMENT_SUCCEEDED,
      title: 'Payment successful',
      message: `Paid ${Number(order.total).toFixed(2)} TND to ${companyName}`,
      metadata: {
        orderId: order.orderId,
        companyId: order.companyId,
        companyName,
        total: Number(order.total),
      },
    });

    const company = await this.companiesRepository.findOne({
      where: { companyId: order.companyId },
    });
    if (company?.userId) {
      void this.notificationsService.createForUser({
        userId: company.userId,
        type: NotificationType.NEW_ORDER,
        title: 'New paid order',
        message: `You received a new order for ${Number(order.total).toFixed(2)} TND.`,
        link: '/company/orders',
        relatedId: order.orderId,
      });
    }
  }

  private async getClientForUser(userId: string) {
    const client = await this.clientsRepository.findOne({
      where: { userId },
    });
    if (!client) {
      throw new NotFoundException('Client account not found');
    }
    return client;
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

  private statusLabel(status: OrderStatus) {
    switch (status) {
      case OrderStatus.PENDING_PAYMENT:
        return 'pending payment';
      case OrderStatus.PAID:
        return 'paid';
      case OrderStatus.PAYMENT_FAILED:
        return 'payment failed';
      case OrderStatus.CANCELLED:
        return 'cancelled';
      case OrderStatus.PROCESSING:
        return 'processing';
      case OrderStatus.SHIPPED:
        return 'shipped';
      case OrderStatus.DELIVERED:
        return 'delivered';
      case OrderStatus.RETURNED:
        return 'returned to seller';
      default:
        return status;
    }
  }

  private toOrderView(order: Order) {
    return {
      orderId: order.orderId,
      status: order.status,
      subtotal: Number(order.subtotal),
      deliveryFee: Number(order.deliveryFee),
      total: Number(order.total),
      trackingId: order.trackingId,
      flouciPaymentId: order.flouciPaymentId,
      shippingAddress: order.shippingAddress,
      shippingPhone: order.shippingPhone ?? null,
      deliveryNote: order.deliveryNote ?? null,
      deliveredAt: order.deliveredAt,
      returnedAt: order.returnedAt,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
      delivery: order.deliveryUser
        ? {
            userId: order.deliveryUser.userId,
            firstName: order.deliveryUser.firstName,
            lastName: order.deliveryUser.lastName,
            phoneNumber: order.deliveryUser.phoneNumber ?? null,
          }
        : order.deliveryUserId
          ? {
              userId: order.deliveryUserId,
              firstName: 'Driver',
              lastName: '',
              phoneNumber: null as string | null,
            }
          : null,
      company: order.company
        ? {
            companyId: order.company.companyId,
            companyName: order.company.companyName,
            address: order.company.address ?? null,
            phoneNumber: order.company.phoneNumber ?? null,
          }
        : {
            companyId: order.companyId,
            companyName: 'Company',
            address: null as string | null,
            phoneNumber: null as string | null,
          },
      items: (order.items ?? []).map((item) => ({
        orderItemId: item.orderItemId,
        productId: item.productId,
        productName: item.productName,
        productImage: this.resolveItemImage(item),
        unitPrice: Number(item.unitPrice),
        quantity: item.quantity,
        lineTotal: Number(item.lineTotal),
      })),
    };
  }

  private toCompanyOrderView(order: Order) {
    const base = this.toOrderView(order);
    const user = order.client?.user;
    return {
      ...base,
      client: user
        ? {
            clientId: order.client.clientId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phoneNumber: user.phoneNumber ?? null,
          }
        : {
            clientId: order.clientId,
            firstName: 'Client',
            lastName: '',
            email: '',
            phoneNumber: null as string | null,
          },
      nextStatuses: this.nextStatusesFor(order.status),
      canAssignDriver: order.status === OrderStatus.PROCESSING && !order.deliveryUserId,
    };
  }

  private toDeliveryOrderView(order: Order) {
    const base = this.toOrderView(order);
    const user = order.client?.user;
    return {
      ...base,
      client: user
        ? {
            clientId: order.client.clientId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phoneNumber:
              order.shippingPhone ?? user.phoneNumber ?? null,
          }
        : {
            clientId: order.clientId,
            firstName: 'Client',
            lastName: '',
            email: '',
            phoneNumber: order.shippingPhone ?? null,
          },
      canMarkDelivered: order.status === OrderStatus.SHIPPED,
      canMarkReturned: order.status === OrderStatus.SHIPPED,
    };
  }

  private nextStatusesFor(status: OrderStatus): CompanyUpdatableStatus[] {
    return COMPANY_UPDATABLE_STATUSES.filter((target) =>
      COMPANY_STATUS_FLOW[target].includes(status),
    );
  }
}
