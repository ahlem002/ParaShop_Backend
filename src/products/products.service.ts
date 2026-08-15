import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { Company } from '../companies/entities/company.entity';
import { Category } from '../categories/entities/category.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { VerificationStatus } from '../common/enums/verification-status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { PromotionsService } from '../promotions/promotions.service';

const LOW_STOCK_THRESHOLD = 5;
const SOLD_OUT_GRACE_DAYS = 10;

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(Company)
    private readonly companiesRepository: Repository<Company>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
    private readonly notificationsService: NotificationsService,
    private readonly promotionsService: PromotionsService,
  ) {}

  async findApprovedPublic() {
    const products = await this.productsRepository.find({
      where: { verificationStatus: VerificationStatus.APPROVED },
      relations: { category: true, company: true },
      order: { createdAt: 'DESC' },
    });

    const sponsorship = await this.promotionsService.getActiveSponsorshipMap();

    const enriched = products.map((product) => {
      const boost = sponsorship.get(product.productId);
      return {
        ...product,
        sponsored: Boolean(
          boost && (boost.home || boost.category || boost.search),
        ),
        sponsorship: boost
          ? {
              home: boost.home,
              category: boost.category,
              search: boost.search,
              paidAt: boost.paidAt,
            }
          : null,
      };
    });

    // Home / general list: home boosts first (by paidAt), then others
    return enriched.sort((a, b) => {
      const aHome = a.sponsorship?.home ? 1 : 0;
      const bHome = b.sponsorship?.home ? 1 : 0;
      if (aHome !== bHome) return bHome - aHome;
      const aPaid = a.sponsorship?.paidAt ?? '';
      const bPaid = b.sponsorship?.paidAt ?? '';
      if (aPaid !== bPaid) return bPaid.localeCompare(aPaid);
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
  }

  async findOneApprovedPublic(productId: string) {
    const product = await this.productsRepository.findOne({
      where: {
        productId,
        verificationStatus: VerificationStatus.APPROVED,
      },
      relations: { category: true, company: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async findMyProducts(userId: string) {
    const company = await this.getCompanyForUser(userId);

    return this.productsRepository.find({
      where: { companyId: company.companyId },
      relations: { category: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findOneForCompany(productId: string, userId: string) {
    const company = await this.getCompanyForUser(userId);
    const product = await this.productsRepository.findOne({
      where: { productId, companyId: company.companyId },
      relations: { category: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async create(userId: string, dto: CreateProductDto, images: string[]) {
    const company = await this.getCompanyForUser(userId);
    await this.ensureCategoryExists(dto.categoryId);

    const product = this.productsRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      categoryId: dto.categoryId,
      price: Number(dto.price),
      stock: Number(dto.stock),
      soldOutAt: Number(dto.stock) < 1 ? new Date() : null,
      laboratory: company.companyName,
      companyId: company.companyId,
      images: images.length ? images : null,
      notice: dto.notice?.trim() ? dto.notice.trim() : null,
      verificationStatus: VerificationStatus.PENDING,
      rejectionReason: null,
    });

    const saved = await this.productsRepository.save(product);

    void this.notificationsService.notifyAdmins({
      type: NotificationType.PRODUCT_PENDING,
      title: 'Product awaiting validation',
      message: `${company.companyName} submitted "${saved.name}" for review.`,
      link: '/admin/product-validations',
      relatedId: saved.productId,
    });

    return this.findOneForCompany(saved.productId, userId);
  }

  async update(
    productId: string,
    userId: string,
    dto: UpdateProductDto,
    images: string[] | undefined,
  ) {
    const company = await this.getCompanyForUser(userId);
    const product = await this.findOneForCompany(productId, userId);

    if (dto.categoryId) {
      await this.ensureCategoryExists(dto.categoryId);
      product.categoryId = dto.categoryId;
    }

    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) {
      product.description = dto.description || null;
    }
    if (dto.price !== undefined) product.price = Number(dto.price);
    if (dto.stock !== undefined) {
      product.stock = Number(dto.stock);
      if (product.stock > 0) {
        product.soldOutAt = null;
      } else if (!product.soldOutAt) {
        product.soldOutAt = new Date();
      }
    }
    if (dto.notice !== undefined) {
      product.notice = dto.notice.trim() ? dto.notice.trim() : null;
    }

    // Always keep laboratory in sync with the company account
    product.laboratory = company.companyName;

    if (images !== undefined) {
      product.images = images.length ? images : product.images;
    }

    // Any company edit sends the product back for admin review
    product.verificationStatus = VerificationStatus.PENDING;
    product.rejectionReason = null;

    await this.productsRepository.save(product);

    void this.notificationsService.notifyAdmins({
      type: NotificationType.PRODUCT_PENDING,
      title: 'Product awaiting validation',
      message: `${company.companyName} updated "${product.name}" and needs review.`,
      link: '/admin/product-validations',
      relatedId: product.productId,
    });

    return this.findOneForCompany(productId, userId);
  }

  /**
   * Stock-only refill/update. Does NOT send the product back to admin validation.
   */
  async updateStock(productId: string, userId: string, stock: number) {
    if (!Number.isInteger(stock) || stock < 0) {
      throw new BadRequestException('Stock must be a whole number >= 0');
    }

    const product = await this.findOneForCompany(productId, userId);
    const previous = Number(product.stock);
    product.stock = stock;

    if (stock > 0) {
      product.soldOutAt = null;
    } else if (!product.soldOutAt) {
      product.soldOutAt = new Date();
    }

    await this.productsRepository.save(product);

    if (previous > 0 && stock === 0) {
      await this.notifySoldOut(product);
    }

    return this.findOneForCompany(productId, userId);
  }

  /**
   * Called after a paid order decreases stock (or cancel restores it).
   */
  async applyStockChangeEffects(
    changes: Array<{ productId: string; previousStock: number; newStock: number }>,
  ) {
    for (const change of changes) {
      const product = await this.productsRepository.findOne({
        where: { productId: change.productId },
        relations: { company: true },
      });
      if (!product) continue;

      if (change.newStock > 0) {
        if (product.soldOutAt) {
          product.soldOutAt = null;
          await this.productsRepository.save(product);
        }
      } else if (change.newStock === 0 && change.previousStock > 0) {
        if (!product.soldOutAt) {
          product.soldOutAt = new Date();
          await this.productsRepository.save(product);
        }
        await this.notifySoldOut(product);
        continue;
      }

      if (
        change.previousStock > LOW_STOCK_THRESHOLD &&
        change.newStock > 0 &&
        change.newStock <= LOW_STOCK_THRESHOLD
      ) {
        await this.notifyLowStock(product);
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredSoldOutProducts() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - SOLD_OUT_GRACE_DAYS);

    const expired = await this.productsRepository.find({
      where: {
        stock: 0,
        soldOutAt: LessThanOrEqual(cutoff),
      },
      relations: { company: true },
    });

    for (const product of expired) {
      const companyUserId = product.company?.userId;
      const name = product.name;
      const productId = product.productId;

      await this.productsRepository.remove(product);
      this.logger.log(
        `Auto-deleted sold-out product ${productId} ("${name}") after ${SOLD_OUT_GRACE_DAYS} days`,
      );

      if (companyUserId) {
        void this.notificationsService.createForUser({
          userId: companyUserId,
          type: NotificationType.PRODUCT_AUTO_DELETED,
          title: 'Product removed (not refilled)',
          message: `"${name}" stayed sold out for ${SOLD_OUT_GRACE_DAYS} days and was deleted. To sell it again, create it as a new product for admin validation.`,
          link: '/company/products',
          relatedId: productId,
        });
      }
    }
  }

  private async notifyLowStock(product: Product) {
    const userId = product.company?.userId;
    if (!userId) {
      const company = await this.companiesRepository.findOne({
        where: { companyId: product.companyId },
      });
      if (!company?.userId) return;
      return this.notificationsService.createForUser({
        userId: company.userId,
        type: NotificationType.PRODUCT_LOW_STOCK,
        title: 'Low stock — refill soon',
        message: `"${product.name}" has only ${product.stock} unit(s) left. Please refill stock.`,
        link: `/company/products/${product.productId}`,
        relatedId: product.productId,
      });
    }

    return this.notificationsService.createForUser({
      userId,
      type: NotificationType.PRODUCT_LOW_STOCK,
      title: 'Low stock — refill soon',
      message: `"${product.name}" has only ${product.stock} unit(s) left. Please refill stock.`,
      link: `/company/products/${product.productId}`,
      relatedId: product.productId,
    });
  }

  private async notifySoldOut(product: Product) {
    let userId = product.company?.userId;
    if (!userId) {
      const company = await this.companiesRepository.findOne({
        where: { companyId: product.companyId },
      });
      if (!company?.userId) return;
      userId = company.userId;
    }

    return this.notificationsService.createForUser({
      userId,
      type: NotificationType.PRODUCT_SOLD_OUT,
      title: 'Product sold out',
      message: `"${product.name}" is sold out. Refill within ${SOLD_OUT_GRACE_DAYS} days or it will be deleted automatically. Clients cannot buy it while stock is 0.`,
      link: `/company/products/${product.productId}`,
      relatedId: product.productId,
    });
  }

  async remove(productId: string, userId: string) {
    const product = await this.findOneForCompany(productId, userId);
    await this.productsRepository.remove(product);
    return { deleted: true };
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

  private async ensureCategoryExists(categoryId: string) {
    const category = await this.categoriesRepository.findOne({
      where: { categoryId },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }
}
