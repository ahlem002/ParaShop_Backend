import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { Company } from '../companies/entities/company.entity';
import { Category } from '../categories/entities/category.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { VerificationStatus } from '../common/enums/verification-status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(Company)
    private readonly companiesRepository: Repository<Company>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findApprovedPublic() {
    return this.productsRepository.find({
      where: { verificationStatus: VerificationStatus.APPROVED },
      relations: { category: true, company: true },
      order: { createdAt: 'DESC' },
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
    if (dto.stock !== undefined) product.stock = Number(dto.stock);
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
