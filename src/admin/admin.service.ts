import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Repository, MoreThanOrEqual } from 'typeorm';
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
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { UpdateAdminClientDto } from './dto/update-admin-client.dto';
import { UpdateAdminCompanyDto } from './dto/update-admin-company.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { MailService } from '../mail/mail.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../common/enums/order-status.enum';

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
  mustChangePassword?: boolean;
  profileCompleted?: boolean;
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

export interface AdminDashboardStats {
  users: {
    total: number;
    clients: number;
    companies: number;
    admins: number;
    active: number;
    blocked: number;
  };
  companies: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  products: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  catalog: {
    /** Estimated inventory value = sum(price × stock) for APPROVED products only. Not real sales revenue. */
    approvedProductValue: number;
    totalStockUnits: number;
  };
  charts: {
    activityLast7Days: Array<{
      date: string;
      label: string;
      users: number;
      products: number;
    }>;
  };
  recent: {
    pendingCompanies: Array<{
      companyId: string;
      companyName: string;
      createdAt: string;
    }>;
    pendingProducts: Array<{
      productId: string;
      name: string;
      companyName: string;
      createdAt: string;
    }>;
  };
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
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
  ) {}

  async createDriver(dto: CreateDriverDto): Promise<AdminUserResponse> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.usersRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const user = await this.usersRepository.save(
      this.usersRepository.create({
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email,
        passwordHash,
        phoneNumber: null,
        birthDate: null,
        gender: null,
        profileImage: null,
        role: Role.DELIVERY,
        status: UserStatus.ACTIVE,
        mustChangePassword: true,
        profileCompleted: false,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        googleId: null,
      }),
    );

    void this.mailService.sendDriverInviteEmail({
      to: email,
      firstName: user.firstName,
      temporaryPassword,
    });

    return this.toUserResponse(user);
  }

  async findAllDrivers(): Promise<AdminUserResponse[]> {
    const drivers = await this.usersRepository.find({
      where: { role: Role.DELIVERY },
      order: { createdAt: 'DESC' },
    });
    return drivers.map((user) => this.toUserResponse(user));
  }

  async getDriver(userId: string): Promise<AdminUserResponse> {
    const driver = await this.requireDriver(userId);
    return this.toUserResponse(driver);
  }

  async resendDriverInvite(userId: string): Promise<AdminUserResponse> {
    const driver = await this.requireDriver(userId);

    if (!driver.mustChangePassword) {
      throw new BadRequestException(
        'This driver already logged in. Use modify instead of resend.',
      );
    }

    const temporaryPassword = this.generateTemporaryPassword();
    driver.passwordHash = await bcrypt.hash(temporaryPassword, 10);
    driver.mustChangePassword = true;
    driver.profileCompleted = false;
    await this.usersRepository.save(driver);

    void this.mailService.sendDriverInviteEmail({
      to: driver.email,
      firstName: driver.firstName,
      temporaryPassword,
    });

    return this.toUserResponse(driver);
  }

  async updateDriver(
    userId: string,
    dto: UpdateDriverDto,
  ): Promise<AdminUserResponse> {
    const driver = await this.requireDriver(userId);

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== driver.email) {
        const existing = await this.usersRepository.findOne({ where: { email } });
        if (existing) {
          throw new ConflictException('An account with this email already exists');
        }
        driver.email = email;
      }
    }

    if (dto.firstName !== undefined) driver.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) driver.lastName = dto.lastName.trim();
    if (dto.phoneNumber !== undefined) {
      driver.phoneNumber = dto.phoneNumber.trim() || null;
    }
    if (dto.gender !== undefined) {
      driver.gender = dto.gender.trim() || null;
    }
    if (dto.birthDate !== undefined) {
      driver.birthDate = dto.birthDate || null;
    }

    if (driver.phoneNumber && driver.gender && driver.birthDate) {
      driver.profileCompleted = true;
    }

    await this.usersRepository.save(driver);
    return this.toUserResponse(driver);
  }

  async deleteDriver(userId: string): Promise<{ success: boolean }> {
    const driver = await this.requireDriver(userId);

    const activeDeliveries = await this.ordersRepository.count({
      where: {
        deliveryUserId: driver.userId,
        status: OrderStatus.SHIPPED,
      },
    });

    if (activeDeliveries > 0) {
      throw new BadRequestException(
        'Cannot delete a driver with active out-for-delivery orders',
      );
    }

    await this.usersRepository.remove(driver);
    return { success: true };
  }

  private async requireDriver(userId: string) {
    const driver = await this.usersRepository.findOne({
      where: { userId, role: Role.DELIVERY },
    });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }
    return driver;
  }

  private generateTemporaryPassword(): string {
    return `Ps+${randomBytes(4).toString('hex')}A1`;
  }

  async getDashboardStats(): Promise<AdminDashboardStats> {
    const [
      totalUsers,
      clientUsers,
      companyUsers,
      adminUsers,
      activeUsers,
      blockedUsers,
      totalCompanies,
      pendingCompanies,
      approvedCompanies,
      rejectedCompanies,
      totalProducts,
      pendingProducts,
      approvedProducts,
      rejectedProducts,
      recentPendingCompanies,
      recentPendingProducts,
      approvedCatalog,
      recentUsers,
      recentProductsForChart,
    ] = await Promise.all([
      this.usersRepository.count(),
      this.usersRepository.count({ where: { role: Role.CLIENT } }),
      this.usersRepository.count({ where: { role: Role.COMPANY } }),
      this.usersRepository.count({ where: { role: Role.ADMIN } }),
      this.usersRepository.count({ where: { status: UserStatus.ACTIVE } }),
      this.usersRepository.count({ where: { status: UserStatus.BLOCKED } }),
      this.companiesRepository.count(),
      this.companiesRepository.count({
        where: { verificationStatus: VerificationStatus.PENDING },
      }),
      this.companiesRepository.count({
        where: { verificationStatus: VerificationStatus.APPROVED },
      }),
      this.companiesRepository.count({
        where: { verificationStatus: VerificationStatus.REJECTED },
      }),
      this.productsRepository.count(),
      this.productsRepository.count({
        where: { verificationStatus: VerificationStatus.PENDING },
      }),
      this.productsRepository.count({
        where: { verificationStatus: VerificationStatus.APPROVED },
      }),
      this.productsRepository.count({
        where: { verificationStatus: VerificationStatus.REJECTED },
      }),
      this.companiesRepository.find({
        where: { verificationStatus: VerificationStatus.PENDING },
        order: { createdAt: 'DESC' },
        take: 5,
      }),
      this.productsRepository.find({
        where: { verificationStatus: VerificationStatus.PENDING },
        relations: { company: true },
        order: { createdAt: 'DESC' },
        take: 5,
      }),
      this.productsRepository.find({
        where: { verificationStatus: VerificationStatus.APPROVED },
        select: { productId: true, price: true, stock: true },
      }),
      this.usersRepository.find({
        where: { createdAt: MoreThanOrEqual(this.daysAgo(6)) },
        select: { userId: true, createdAt: true },
      }),
      this.productsRepository.find({
        where: { createdAt: MoreThanOrEqual(this.daysAgo(6)) },
        select: { productId: true, createdAt: true },
      }),
    ]);

    const approvedProductValue = approvedCatalog.reduce(
      (sum, product) => sum + Number(product.price) * Number(product.stock),
      0,
    );
    const totalStockUnits = approvedCatalog.reduce(
      (sum, product) => sum + Number(product.stock),
      0,
    );

    return {
      users: {
        total: totalUsers,
        clients: clientUsers,
        companies: companyUsers,
        admins: adminUsers,
        active: activeUsers,
        blocked: blockedUsers,
      },
      companies: {
        total: totalCompanies,
        pending: pendingCompanies,
        approved: approvedCompanies,
        rejected: rejectedCompanies,
      },
      products: {
        total: totalProducts,
        pending: pendingProducts,
        approved: approvedProducts,
        rejected: rejectedProducts,
      },
      catalog: {
        approvedProductValue: Math.round(approvedProductValue * 100) / 100,
        totalStockUnits,
      },
      charts: {
        activityLast7Days: this.buildLast7DaysSeries(
          recentUsers.map((u) => u.createdAt),
          recentProductsForChart.map((p) => p.createdAt),
        ),
      },
      recent: {
        pendingCompanies: recentPendingCompanies.map((company) => ({
          companyId: company.companyId,
          companyName: company.companyName,
          createdAt: company.createdAt.toISOString(),
        })),
        pendingProducts: recentPendingProducts.map((product) => ({
          productId: product.productId,
          name: product.name,
          companyName: product.company?.companyName ?? '—',
          createdAt: product.createdAt.toISOString(),
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

  private buildLast7DaysSeries(userDates: Date[], productDates: Date[]) {
    const days: Array<{
      date: string;
      label: string;
      users: number;
      products: number;
    }> = [];

    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - i);
      const key = day.toISOString().slice(0, 10);
      days.push({
        date: key,
        label: day.toLocaleDateString('fr-FR', {
          weekday: 'short',
          day: '2-digit',
        }),
        users: 0,
        products: 0,
      });
    }

    const indexByKey = new Map(days.map((day, index) => [day.date, index]));

    for (const createdAt of userDates) {
      const key = createdAt.toISOString().slice(0, 10);
      const index = indexByKey.get(key);
      if (index !== undefined) days[index].users += 1;
    }

    for (const createdAt of productDates) {
      const key = createdAt.toISOString().slice(0, 10);
      const index = indexByKey.get(key);
      if (index !== undefined) days[index].products += 1;
    }

    return days;
  }

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

  async updateUser(
    userId: string,
    dto: UpdateAdminUserDto,
  ): Promise<AdminUserResponse> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      relations: { company: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== user.email) {
        const existing = await this.usersRepository.findOne({ where: { email } });
        if (existing) {
          throw new ConflictException('An account with this email already exists');
        }
        user.email = email;
      }
    }

    if (dto.firstName !== undefined) user.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) user.lastName = dto.lastName.trim();
    if (dto.phoneNumber !== undefined) {
      user.phoneNumber = dto.phoneNumber.trim() || null;
    }
    if (dto.gender !== undefined) user.gender = dto.gender.trim() || null;
    if (dto.birthDate !== undefined) user.birthDate = dto.birthDate || null;
    if (dto.status !== undefined) user.status = dto.status;

    await this.usersRepository.save(user);
    return this.toUserResponse(user);
  }

  async deleteUser(userId: string): Promise<{ success: boolean }> {
    const user = await this.usersRepository.findOne({
      where: { userId },
      relations: { company: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === Role.ADMIN) {
      const adminCount = await this.usersRepository.count({
        where: { role: Role.ADMIN },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot delete the last admin account');
      }
    }

    if (user.role === Role.DELIVERY) {
      const activeDeliveries = await this.ordersRepository.count({
        where: {
          deliveryUserId: user.userId,
          status: OrderStatus.SHIPPED,
        },
      });
      if (activeDeliveries > 0) {
        throw new BadRequestException(
          'Cannot delete a driver with active out-for-delivery orders',
        );
      }
    }

    await this.usersRepository.remove(user);
    return { success: true };
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

  async updateClient(
    clientId: string,
    dto: UpdateAdminClientDto,
  ): Promise<AdminClientResponse> {
    const client = await this.clientsRepository.findOne({
      where: { clientId },
      relations: { user: true },
    });

    if (!client || client.user.role !== Role.CLIENT) {
      throw new NotFoundException('Client not found');
    }

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== client.user.email) {
        const existing = await this.usersRepository.findOne({ where: { email } });
        if (existing) {
          throw new ConflictException('An account with this email already exists');
        }
        client.user.email = email;
      }
    }

    if (dto.firstName !== undefined) {
      client.user.firstName = dto.firstName.trim();
    }
    if (dto.lastName !== undefined) {
      client.user.lastName = dto.lastName.trim();
    }
    if (dto.phoneNumber !== undefined) {
      client.user.phoneNumber = dto.phoneNumber.trim() || null;
    }
    if (dto.gender !== undefined) {
      client.user.gender = dto.gender.trim() || null;
    }
    if (dto.birthDate !== undefined) {
      client.user.birthDate = dto.birthDate || null;
    }
    if (dto.status !== undefined) {
      client.user.status = dto.status;
    }
    if (dto.address !== undefined) {
      client.address = dto.address.trim() || null;
    }

    await this.usersRepository.save(client.user);
    await this.clientsRepository.save(client);
    return this.toClientResponse(client);
  }

  async deleteClient(clientId: string): Promise<{ success: boolean }> {
    const client = await this.clientsRepository.findOne({
      where: { clientId },
      relations: { user: true },
    });

    if (!client || client.user.role !== Role.CLIENT) {
      throw new NotFoundException('Client not found');
    }

    await this.usersRepository.remove(client.user);
    return { success: true };
  }

  async findAllCompanies(): Promise<AdminCompanyResponse[]> {
    const companies = await this.companiesRepository.find({
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });

    return companies.map((company) => this.toCompanyResponse(company));
  }

  async updateCompany(
    companyId: string,
    dto: UpdateAdminCompanyDto,
  ): Promise<AdminCompanyResponse> {
    const company = await this.companiesRepository.findOne({
      where: { companyId },
      relations: { user: true },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    if (dto.companyName !== undefined) {
      company.companyName = dto.companyName.trim();
    }
    if (dto.companyType !== undefined) {
      company.companyType = dto.companyType;
    }
    if (dto.establishmentDate !== undefined) {
      company.establishmentDate = dto.establishmentDate;
    }
    if (dto.description !== undefined) {
      company.description = dto.description.trim() || null;
    }
    if (dto.email !== undefined) {
      company.email = dto.email.trim().toLowerCase();
    }
    if (dto.phoneNumber !== undefined) {
      company.phoneNumber = dto.phoneNumber.trim() || null;
    }
    if (dto.address !== undefined) {
      company.address = dto.address.trim() || null;
    }
    if (dto.ownerFirstName !== undefined && company.user) {
      company.user.firstName = dto.ownerFirstName.trim();
    }
    if (dto.ownerLastName !== undefined && company.user) {
      company.user.lastName = dto.ownerLastName.trim();
    }
    if (dto.ownerStatus !== undefined && company.user) {
      company.user.status = dto.ownerStatus;
    }

    if (company.user) {
      await this.usersRepository.save(company.user);
    }
    await this.companiesRepository.save(company);
    return this.toCompanyResponse(company);
  }

  async deleteCompany(companyId: string): Promise<{ success: boolean }> {
    const company = await this.companiesRepository.findOne({
      where: { companyId },
      relations: { user: true },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    if (company.user) {
      await this.usersRepository.remove(company.user);
    } else {
      await this.companiesRepository.remove(company);
    }
    return { success: true };
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
      mustChangePassword: Boolean(user.mustChangePassword),
      profileCompleted:
        user.profileCompleted !== undefined
          ? Boolean(user.profileCompleted)
          : true,
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
