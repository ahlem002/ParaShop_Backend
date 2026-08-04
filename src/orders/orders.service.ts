import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Client } from '../clients/entities/client.entity';
import { Company } from '../companies/entities/company.entity';
import { ActivityType } from '../common/enums/activity-type.enum';
import { OrderStatus } from '../common/enums/order-status.enum';
import { VerificationStatus } from '../common/enums/verification-status.enum';
import { ActivityService } from '../activity/activity.service';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { CheckoutDto } from './dto/checkout.dto';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { FlouciService } from './flouci.service';

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
    private readonly flouciService: FlouciService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly activityService: ActivityService,
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

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ??
      'http://localhost:5173';
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ??
      `http://localhost:${this.configService.get('PORT') ?? 3000}`;

    const payment = await this.flouciService.generatePayment({
      amountMillimes,
      trackingId,
      clientLabel: `${user.firstName} ${user.lastName}`.trim() || user.email,
      successLink: `${frontendUrl}/orders/payment/success?orderId=${order.orderId}`,
      failLink: `${frontendUrl}/orders/payment/fail?orderId=${order.orderId}`,
      webhookUrl: `${backendUrl}/api/orders/flouci/webhook`,
    });

    order.flouciPaymentId = payment.paymentId;
    await this.ordersRepository.save(order);

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

    return {
      orderId: order.orderId,
      trackingId: order.trackingId,
      total: order.total,
      amountMillimes: order.amountMillimes,
      paymentId: payment.paymentId,
      paymentUrl: payment.link,
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
      relations: { company: true, items: { product: true } },
      order: { createdAt: 'DESC' },
    });

    await this.backfillMissingItemImages(orders.flatMap((o) => o.items ?? []));

    return orders.map((order) => this.toOrderView(order));
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
      order.status === OrderStatus.DELIVERED
    ) {
      throw new BadRequestException(
        'Shipped or delivered orders cannot be cancelled',
      );
    }

    const shouldRestoreStock =
      order.status === OrderStatus.PAID ||
      order.status === OrderStatus.PROCESSING;

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
        locked.status === OrderStatus.DELIVERED
      ) {
        throw new BadRequestException(
          'Shipped or delivered orders cannot be cancelled',
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
          product.stock += line.quantity;
          await productRepo.save(product);
        }
      }

      locked.status = OrderStatus.CANCELLED;
      await orderRepo.save(locked);
    });

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
        product.stock -= line.quantity;
        await productRepo.save(product);
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
      paidAt: order.paidAt,
      createdAt: order.createdAt,
      company: order.company
        ? {
            companyId: order.company.companyId,
            companyName: order.company.companyName,
          }
        : { companyId: order.companyId, companyName: 'Company' },
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
}
