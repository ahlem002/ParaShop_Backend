import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../clients/entities/client.entity';
import { Product } from '../products/entities/product.entity';
import { VerificationStatus } from '../common/enums/verification-status.enum';
import { Favorite } from './entities/favorite.entity';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(Favorite)
    private readonly favoritesRepository: Repository<Favorite>,
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
  ) {}

  async list(userId: string) {
    const client = await this.getClientForUser(userId);
    const rows = await this.favoritesRepository.find({
      where: { clientId: client.clientId },
      relations: { product: { company: true, category: true } },
      order: { createdAt: 'DESC' },
    });

    return {
      items: rows
        .filter((row) => row.product)
        .map((row) => this.toFavoriteView(row)),
      count: rows.filter((row) => row.product).length,
      productIds: rows.filter((row) => row.product).map((row) => row.productId),
    };
  }

  async add(userId: string, productId: string) {
    const client = await this.getClientForUser(userId);
    const product = await this.getApprovedProduct(productId);

    let favorite = await this.favoritesRepository.findOne({
      where: { clientId: client.clientId, productId: product.productId },
      relations: { product: { company: true, category: true } },
    });

    if (!favorite) {
      favorite = await this.favoritesRepository.save(
        this.favoritesRepository.create({
          clientId: client.clientId,
          productId: product.productId,
        }),
      );
      favorite = await this.favoritesRepository.findOneOrFail({
        where: { favoriteId: favorite.favoriteId },
        relations: { product: { company: true, category: true } },
      });
    }

    return this.list(userId);
  }

  async remove(userId: string, productId: string) {
    const client = await this.getClientForUser(userId);
    const favorite = await this.favoritesRepository.findOne({
      where: { clientId: client.clientId, productId },
    });

    if (!favorite) {
      throw new NotFoundException('Favorite not found');
    }

    await this.favoritesRepository.remove(favorite);
    return this.list(userId);
  }

  async toggle(userId: string, productId: string) {
    const client = await this.getClientForUser(userId);
    const existing = await this.favoritesRepository.findOne({
      where: { clientId: client.clientId, productId },
    });

    if (existing) {
      await this.favoritesRepository.remove(existing);
      return this.list(userId);
    }

    return this.add(userId, productId);
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
    });

    if (!product) {
      throw new NotFoundException('Product not found or not available');
    }

    return product;
  }

  private toFavoriteView(row: Favorite) {
    const product = row.product;
    return {
      favoriteId: row.favoriteId,
      createdAt: row.createdAt,
      product: {
        productId: product.productId,
        name: product.name,
        description: product.description,
        images: product.images,
        price: Number(product.price),
        stock: product.stock,
        notice: product.notice,
        laboratory: product.laboratory,
        category: product.category
          ? {
              categoryId: product.category.categoryId,
              name: product.category.name,
              description: product.category.description ?? null,
              image: product.category.image ?? null,
            }
          : undefined,
        company: product.company
          ? {
              companyId: product.company.companyId,
              companyName: product.company.companyName,
            }
          : undefined,
      },
    };
  }
}
