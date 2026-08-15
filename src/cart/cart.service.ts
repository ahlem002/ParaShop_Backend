import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CartItem } from './entities/cart-item.entity';
import { Client } from '../clients/entities/client.entity';
import { Product } from '../products/entities/product.entity';
import { ActivityType } from '../common/enums/activity-type.enum';
import { VerificationStatus } from '../common/enums/verification-status.enum';
import { ActivityService } from '../activity/activity.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartItem)
    private readonly cartItemsRepository: Repository<CartItem>,
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    private readonly activityService: ActivityService,
  ) {}

  async getCart(userId: string) {
    const client = await this.getClientForUser(userId);
    const items = await this.cartItemsRepository.find({
      where: { clientId: client.clientId },
      relations: { product: { company: true, category: true } },
      order: { createdAt: 'ASC' },
    });

    return this.toCartResponse(items);
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const client = await this.getClientForUser(userId);
    const product = await this.getApprovedProduct(dto.productId);

    if (product.stock < 1) {
      throw new BadRequestException('This product is out of stock');
    }

    let item = await this.cartItemsRepository.findOne({
      where: { clientId: client.clientId, productId: product.productId },
    });

    const nextQuantity = (item?.quantity ?? 0) + dto.quantity;
    if (nextQuantity > product.stock) {
      throw new BadRequestException(
        `Only ${product.stock} unit(s) available in stock`,
      );
    }

    if (item) {
      item.quantity = nextQuantity;
    } else {
      item = this.cartItemsRepository.create({
        clientId: client.clientId,
        productId: product.productId,
        quantity: dto.quantity,
      });
    }

    await this.cartItemsRepository.save(item);

    await this.activityService.log({
      userId,
      type: ActivityType.CART_ITEM_ADDED,
      title: 'Added to cart',
      message: `Added ${dto.quantity} × ${product.name} to your cart`,
      metadata: {
        productId: product.productId,
        productName: product.name,
        quantity: dto.quantity,
        companyId: product.companyId,
      },
    });

    return this.getCart(userId);
  }

  async updateItem(userId: string, cartItemId: string, dto: UpdateCartItemDto) {
    const client = await this.getClientForUser(userId);
    const item = await this.cartItemsRepository.findOne({
      where: { cartItemId, clientId: client.clientId },
      relations: { product: true },
    });

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    if (dto.quantity < 1) {
      throw new BadRequestException('Quantity must be at least 1');
    }

    if (item.product.stock < 1) {
      throw new BadRequestException('This product is out of stock');
    }

    if (dto.quantity > item.product.stock) {
      throw new BadRequestException(
        `Only ${item.product.stock} unit(s) available in stock`,
      );
    }

    const previousQuantity = item.quantity;
    item.quantity = dto.quantity;
    await this.cartItemsRepository.save(item);

    await this.activityService.log({
      userId,
      type: ActivityType.CART_ITEM_UPDATED,
      title: 'Cart updated',
      message: `Updated ${item.product.name} quantity from ${previousQuantity} to ${dto.quantity}`,
      metadata: {
        cartItemId,
        productId: item.product.productId,
        productName: item.product.name,
        previousQuantity,
        quantity: dto.quantity,
      },
    });

    return this.getCart(userId);
  }

  async removeItem(userId: string, cartItemId: string) {
    const client = await this.getClientForUser(userId);
    const item = await this.cartItemsRepository.findOne({
      where: { cartItemId, clientId: client.clientId },
      relations: { product: true },
    });

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    const productName = item.product?.name ?? 'a product';
    const productId = item.productId;
    const quantity = item.quantity;

    await this.cartItemsRepository.remove(item);

    await this.activityService.log({
      userId,
      type: ActivityType.CART_ITEM_REMOVED,
      title: 'Removed from cart',
      message: `Removed ${productName} from your cart`,
      metadata: { cartItemId, productId, productName, quantity },
    });

    return this.getCart(userId);
  }

  async clear(userId: string) {
    const client = await this.getClientForUser(userId);
    const count = await this.cartItemsRepository.count({
      where: { clientId: client.clientId },
    });
    await this.cartItemsRepository.delete({ clientId: client.clientId });

    await this.activityService.log({
      userId,
      type: ActivityType.CART_CLEARED,
      title: 'Cart cleared',
      message:
        count > 0
          ? `Cleared ${count} item(s) from your cart`
          : 'Cleared your cart',
      metadata: { itemCount: count },
    });

    return this.getCart(userId);
  }

  async clearCompany(userId: string, companyId: string) {
    const client = await this.getClientForUser(userId);
    const items = await this.cartItemsRepository.find({
      where: { clientId: client.clientId },
      relations: { product: { company: true } },
    });

    const toRemove = items.filter((item) => item.product.companyId === companyId);
    const companyName =
      toRemove[0]?.product?.company?.companyName ?? 'company';

    if (toRemove.length) {
      await this.cartItemsRepository.remove(toRemove);
    }

    await this.activityService.log({
      userId,
      type: ActivityType.CART_COMPANY_CLEARED,
      title: 'Company cart cleared',
      message: `Removed ${toRemove.length} item(s) from ${companyName}`,
      metadata: {
        companyId,
        companyName,
        itemCount: toRemove.length,
      },
    });

    return this.getCart(userId);
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

  private async getApprovedProduct(productId: string) {
    const product = await this.productsRepository.findOne({
      where: {
        productId,
        verificationStatus: VerificationStatus.APPROVED,
      },
      relations: { company: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found or not available');
    }

    return product;
  }

  private toCartResponse(items: CartItem[]) {
    const mapped = items
      .filter((item) => item.product)
      .map((item) => {
        const price = Number(item.product.price);
        const lineTotal = price * item.quantity;
        return {
          cartItemId: item.cartItemId,
          quantity: item.quantity,
          lineTotal,
          product: {
            productId: item.product.productId,
            name: item.product.name,
            price,
            stock: item.product.stock,
            images: item.product.images,
            laboratory: item.product.laboratory,
            category: item.product.category
              ? {
                  categoryId: item.product.category.categoryId,
                  name: item.product.category.name,
                }
              : null,
            company: {
              companyId: item.product.company?.companyId ?? item.product.companyId,
              companyName:
                item.product.company?.companyName ?? item.product.laboratory,
              deliveryFee: Number(item.product.company?.deliveryFee ?? 0),
            },
          },
        };
      });

    const groupsMap = new Map<
      string,
      {
        companyId: string;
        companyName: string;
        deliveryFee: number;
        items: typeof mapped;
        subtotal: number;
        total: number;
      }
    >();

    for (const item of mapped) {
      const companyId = item.product.company.companyId;
      let group = groupsMap.get(companyId);
      if (!group) {
        group = {
          companyId,
          companyName: item.product.company.companyName,
          deliveryFee: item.product.company.deliveryFee,
          items: [],
          subtotal: 0,
          total: 0,
        };
        groupsMap.set(companyId, group);
      }
      group.items.push(item);
      group.subtotal += item.lineTotal;
    }

    const groups = Array.from(groupsMap.values()).map((group) => ({
      ...group,
      subtotal: Number(group.subtotal.toFixed(2)),
      total: Number((group.subtotal + group.deliveryFee).toFixed(2)),
    }));

    const itemCount = mapped.reduce((sum, item) => sum + item.quantity, 0);

    return {
      items: mapped,
      groups,
      itemCount,
    };
  }
}
