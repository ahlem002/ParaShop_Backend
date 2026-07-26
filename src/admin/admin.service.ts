import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../clients/entities/client.entity';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { AdminApproval } from '../admin-approvals/entities/admin-approval.entity';
import { Product } from '../products/entities/product.entity';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { VerificationStatus } from '../common/enums/verification-status.enum';
import { ApprovalDecision } from '../common/enums/approval-decision.enum';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateCompanyVerificationDto } from './dto/update-company-verification.dto';
import { UpdateProductVerificationDto } from './dto/update-product-verification.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';

export interface AdminUserResponse {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  birthDate: string | null;
  gender: string | null;
  role: Role;
  status: UserStatus;
  companyVerificationStatus: VerificationStatus | null;
  createdAt: Date;
}

export interface AdminClientResponse {
  clientId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  birthDate: string | null;
  gender: string | null;
  address: string | null;
  status: UserStatus;
  createdAt: Date;
}

export interface AdminCompanyResponse {
  companyId: string;
  companyName: string;
  companyType: string | null;
  establishmentDate: string | null;
  description: string | null;
  email: string;
  phoneNumber: string | null;
  address: string | null;
  proofDocument: string | null;
  verificationStatus: VerificationStatus;
  createdAt: Date;
  owner: {
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
    status: UserStatus;
  };
}

export interface AdminProductResponse {
  productId: string;
  name: string;
  description: string | null;
  images: string[] | null;
  price: number;
  stock: number;
  notice: string | null;
  laboratory: string;
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
  category: { categoryId: string; name: string } | null;
  company: {
    companyId: string;
    companyName: string;
    email: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(Company)
    private readonly companiesRepository: Repository<Company>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(AdminApproval)
    private readonly approvalsRepository: Repository<AdminApproval>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAllUsers(): Promise<AdminUserResponse[]> {
    const users = await this.usersRepository.find({
      relations: { company: true },
      order: { createdAt: 'DESC' },
    });

    return users.map((user) => this.toUserResponse(user));
  }

  async updateUserStatus(
    userId: string,
    dto: UpdateUserStatusDto,
  ): Promise<AdminUserResponse> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      relations: { company: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.status = dto.status;
    await this.usersRepository.save(user);

    return this.toUserResponse(user);
  }

  async findAllClients(): Promise<AdminClientResponse[]> {
    const clients = await this.clientsRepository
      .createQueryBuilder('client')
      .innerJoinAndSelect('client.user', 'user')
      .where('user.role = :role', { role: Role.CLIENT })
      .orderBy('user.createdAt', 'DESC')
      .getMany();

    return clients.map((client) => this.toClientResponse(client));
  }

  async updateClientStatus(
    clientId: string,
    dto: UpdateUserStatusDto,
  ): Promise<AdminClientResponse> {
    const client = await this.clientsRepository.findOne({
      where: { clientId },
      relations: { user: true },
    });

    if (!client || client.user.role !== Role.CLIENT) {
      throw new NotFoundException('Client not found');
    }

    client.user.status = dto.status;
    await this.usersRepository.save(client.user);

    return this.toClientResponse(client);
  }

  async findAllCompanies(): Promise<AdminCompanyResponse[]> {
    const companies = await this.companiesRepository.find({
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });

    return companies.map((company) => this.toCompanyResponse(company));
  }

  async updateCompanyVerification(
    companyId: string,
    dto: UpdateCompanyVerificationDto,
    adminUserId: string,
  ): Promise<AdminCompanyResponse> {
    const company = await this.companiesRepository.findOne({
      where: { companyId },
      relations: { user: true },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    company.verificationStatus =
      dto.decision === ApprovalDecision.APPROVED
        ? VerificationStatus.APPROVED
        : VerificationStatus.REJECTED;

    await this.companiesRepository.save(company);

    const approval = this.approvalsRepository.create({
      companyId: company.companyId,
      adminUserId,
      decision: dto.decision,
      reason: dto.reason ?? null,
    });

    await this.approvalsRepository.save(approval);

    return this.toCompanyResponse(company);
  }

  async findAllProducts(): Promise<AdminProductResponse[]> {
    const products = await this.productsRepository.find({
      relations: { category: true, company: true },
      order: { createdAt: 'DESC' },
    });

    return products.map((product) => this.toProductResponse(product));
  }

  async updateProductVerification(
    productId: string,
    dto: UpdateProductVerificationDto,
  ): Promise<AdminProductResponse> {
    const product = await this.productsRepository.findOne({
      where: { productId },
      relations: { category: true, company: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (dto.decision === ApprovalDecision.APPROVED) {
      product.verificationStatus = VerificationStatus.APPROVED;
      product.rejectionReason = null;
    } else {
      const reason = dto.reason?.trim();
      if (!reason || reason.length < 3) {
        throw new BadRequestException(
          'A rejection reason of at least 3 characters is required',
        );
      }
      product.verificationStatus = VerificationStatus.REJECTED;
      product.rejectionReason = reason;
    }

    await this.productsRepository.save(product);

    const companyUserId = product.company?.userId;
    if (companyUserId) {
      const approved = dto.decision === ApprovalDecision.APPROVED;
      void this.notificationsService.createForUser({
        userId: companyUserId,
        type: approved
          ? NotificationType.PRODUCT_APPROVED
          : NotificationType.PRODUCT_REJECTED,
        title: approved ? 'Product approved' : 'Product rejected',
        message: approved
          ? `Your product "${product.name}" has been approved and is now visible.`
          : `Your product "${product.name}" was rejected${
              product.rejectionReason ? `: ${product.rejectionReason}` : '.'
            }`,
        link: '/company/products',
        relatedId: product.productId,
      });
    }

    return this.toProductResponse(product);
  }

  private toUserResponse(user: User): AdminUserResponse {
    return {
      userId: user.userId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      birthDate: user.birthDate,
      gender: user.gender,
      role: user.role,
      status: user.status,
      companyVerificationStatus: user.company?.verificationStatus ?? null,
      createdAt: user.createdAt,
    };
  }

  private toClientResponse(client: Client): AdminClientResponse {
    return {
      clientId: client.clientId,
      userId: client.user.userId,
      firstName: client.user.firstName,
      lastName: client.user.lastName,
      email: client.user.email,
      phoneNumber: client.user.phoneNumber,
      birthDate: client.user.birthDate,
      gender: client.user.gender,
      address: client.address,
      status: client.user.status,
      createdAt: client.user.createdAt,
    };
  }

  private toCompanyResponse(company: Company): AdminCompanyResponse {
    return {
      companyId: company.companyId,
      companyName: company.companyName,
      companyType: company.companyType ?? null,
      establishmentDate: company.establishmentDate ?? null,
      description: company.description,
      email: company.email,
      phoneNumber: company.phoneNumber,
      address: company.address,
      proofDocument: company.proofDocument,
      verificationStatus: company.verificationStatus,
      createdAt: company.createdAt,
      owner: {
        userId: company.user.userId,
        firstName: company.user.firstName,
        lastName: company.user.lastName,
        email: company.user.email,
        status: company.user.status,
      },
    };
  }

  private toProductResponse(product: Product): AdminProductResponse {
    return {
      productId: product.productId,
      name: product.name,
      description: product.description,
      images: product.images,
      price: Number(product.price),
      stock: product.stock,
      notice: product.notice,
      laboratory: product.laboratory,
      verificationStatus: product.verificationStatus,
      rejectionReason: product.rejectionReason,
      category: product.category
        ? {
            categoryId: product.category.categoryId,
            name: product.category.name,
          }
        : null,
      company: {
        companyId: product.company.companyId,
        companyName: product.company.companyName,
        email: product.company.email,
      },
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}
