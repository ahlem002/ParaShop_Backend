import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Client } from '../clients/entities/client.entity';
import { Company } from '../companies/entities/company.entity';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { VerificationStatus } from '../common/enums/verification-status.enum';
import { RegisterClientDto } from './dto/register-client.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

export interface AuthUserResponse {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  birthDate: string | null;
  gender: string | null;
  role: Role;
  companyVerificationStatus: VerificationStatus | null;
  address: string | null;
  profileImage: string | null;
  createdAt: string | null;
  company: {
    companyId: string;
    companyName: string;
    companyType: string;
    establishmentDate: string;
    description: string | null;
    phoneNumber: string | null;
    email: string;
    proofDocument: string | null;
  } | null;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUserResponse;
}

@Injectable()
export class AuthService {
  private readonly saltRounds = 10;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(Company)
    private readonly companiesRepository: Repository<Company>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async registerClient(dto: RegisterClientDto): Promise<AuthResponse> {
    const normalizedEmail = this.normalizeEmail(dto.email);

    return this.dataSource.transaction(async (manager) => {
      const usersRepository = manager.getRepository(User);
      const clientsRepository = manager.getRepository(Client);

      await this.ensureEmailIsAvailable(usersRepository, normalizedEmail);

      const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

      const user = usersRepository.create({
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: normalizedEmail,
        passwordHash,
        phoneNumber: dto.phoneNumber ?? null,
        birthDate: dto.birthDate ?? null,
        gender: dto.gender ?? null,
        role: dto.role,
        status: UserStatus.ACTIVE,
      });

      const savedUser = await usersRepository.save(user);

      const client = clientsRepository.create({
        userId: savedUser.userId,
        address: dto.address ?? null,
      });

      await clientsRepository.save(client);

      const fullUser = await usersRepository.findOne({
        where: { userId: savedUser.userId },
        relations: { client: true },
      });

      return this.buildAuthResponse(fullUser ?? savedUser, null);
    });
  }

  async registerCompany(dto: RegisterCompanyDto): Promise<AuthResponse> {
    const normalizedEmail = this.normalizeEmail(dto.email);

    return this.dataSource.transaction(async (manager) => {
      const usersRepository = manager.getRepository(User);
      const companiesRepository = manager.getRepository(Company);

      await this.ensureEmailIsAvailable(usersRepository, normalizedEmail);

      const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

      const user = usersRepository.create({
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: normalizedEmail,
        passwordHash,
        phoneNumber: dto.phoneNumber ?? null,
        birthDate: null,
        gender: null,
        role: Role.COMPANY,
        status: UserStatus.ACTIVE,
      });

      const savedUser = await usersRepository.save(user);

      const company = companiesRepository.create({
        userId: savedUser.userId,
        companyName: dto.companyName,
        companyType: dto.companyType,
        establishmentDate: dto.establishmentDate,
        description: dto.description ?? null,
        address: dto.address ?? null,
        phoneNumber: dto.companyPhoneNumber ?? null,
        email: normalizedEmail,
        proofDocument: dto.proofDocument ?? null,
        verificationStatus: VerificationStatus.PENDING,
      });

      await companiesRepository.save(company);

      const fullUser = await usersRepository.findOne({
        where: { userId: savedUser.userId },
        relations: { company: true },
      });

      return this.buildAuthResponse(
        fullUser ?? savedUser,
        VerificationStatus.PENDING,
      );
    });
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const normalizedEmail = this.normalizeEmail(dto.email);

    const user = await this.usersRepository.findOne({
      where: { email: normalizedEmail },
      relations: { company: true, client: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === UserStatus.BLOCKED) {
      throw new ForbiddenException('Your account has been blocked');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const companyVerificationStatus = user.company?.verificationStatus ?? null;

    return this.buildAuthResponse(user, companyVerificationStatus);
  }

  async getProfile(userId: string): Promise<AuthUserResponse> {
    const user = await this.loadUserWithRelations(userId);
    return this.toAuthUser(user, user.company?.verificationStatus ?? null);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    profileImage?: string | null,
  ): Promise<AuthUserResponse> {
    const user = await this.loadUserWithRelations(userId);

    if (dto.firstName !== undefined) user.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) user.lastName = dto.lastName.trim();
    if (dto.phoneNumber !== undefined) {
      user.phoneNumber = dto.phoneNumber.trim() || null;
    }

    if (user.role === Role.CLIENT || user.role === Role.ADMIN) {
      if (dto.birthDate !== undefined) {
        user.birthDate = dto.birthDate || null;
      }
      if (dto.gender !== undefined) {
        user.gender = dto.gender || null;
      }
    }

    await this.usersRepository.save(user);

    if (profileImage !== undefined) {
      await this.usersRepository.update(
        { userId },
        { profileImage },
      );
      user.profileImage = profileImage;
    }

    if (user.role === Role.CLIENT || user.role === Role.ADMIN) {
      let client = user.client;
      if (!client) {
        client = this.clientsRepository.create({ userId: user.userId });
      }

      if (dto.address !== undefined) {
        client.address = dto.address.trim() || null;
      }
      if (profileImage !== undefined) {
        client.profileImage = profileImage;
      }

      await this.clientsRepository.save(client);
      user.client = client;
    }

    if (user.role === Role.COMPANY && user.company) {
      if (dto.companyName !== undefined) {
        user.company.companyName = dto.companyName.trim();
      }
      if (dto.description !== undefined) {
        user.company.description = dto.description.trim() || null;
      }
      if (dto.address !== undefined) {
        user.company.address = dto.address.trim() || null;
      }
      if (dto.companyPhoneNumber !== undefined) {
        user.company.phoneNumber = dto.companyPhoneNumber.trim() || null;
      }

      await this.companiesRepository.save(user.company);
    }

    const refreshed = await this.loadUserWithRelations(userId);
    return this.toAuthUser(
      refreshed,
      refreshed.company?.verificationStatus ?? null,
    );
  }

  private async loadUserWithRelations(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { userId },
      relations: { company: true, client: true },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }

  private async ensureEmailIsAvailable(
    usersRepository: Repository<User>,
    email: string,
  ): Promise<void> {
    const existingUser = await usersRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private buildAuthResponse(
    user: User,
    companyVerificationStatus: VerificationStatus | null,
  ): AuthResponse {
    const payload: JwtPayload = {
      sub: user.userId,
      email: user.email,
      role: user.role,
      companyVerificationStatus,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: this.toAuthUser(user, companyVerificationStatus),
    };
  }

  private toAuthUser(
    user: User,
    companyVerificationStatus: VerificationStatus | null,
  ): AuthUserResponse {
    return {
      userId: user.userId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      birthDate: this.formatDateOnly(user.birthDate),
      gender: user.gender,
      role: user.role,
      companyVerificationStatus,
      address:
        user.role === Role.COMPANY
          ? (user.company?.address ?? null)
          : (user.client?.address ?? null),
      profileImage: user.profileImage ?? user.client?.profileImage ?? null,
      createdAt: user.createdAt
        ? new Date(user.createdAt).toISOString()
        : null,
      company: user.company
        ? {
            companyId: user.company.companyId,
            companyName: user.company.companyName,
            companyType: user.company.companyType,
            establishmentDate:
              this.formatDateOnly(user.company.establishmentDate) ??
              user.company.establishmentDate,
            description: user.company.description,
            phoneNumber: user.company.phoneNumber,
            email: user.company.email,
            proofDocument: user.company.proofDocument,
          }
        : null,
    };
  }

  private formatDateOnly(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    if (typeof value === 'string') {
      return value.slice(0, 10);
    }
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
