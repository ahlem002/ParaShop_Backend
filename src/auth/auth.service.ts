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
import { JwtPayload } from './interfaces/jwt-payload.interface';

export interface AuthUserResponse {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  companyVerificationStatus: VerificationStatus | null;
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

      return this.buildAuthResponse(savedUser, null);
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

      return this.buildAuthResponse(savedUser, VerificationStatus.PENDING);
    });
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const normalizedEmail = this.normalizeEmail(dto.email);

    const user = await this.usersRepository.findOne({
      where: { email: normalizedEmail },
      relations: { company: true },
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
    const user = await this.usersRepository.findOne({
      where: { userId },
      relations: { company: true },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    return this.toAuthUser(user, user.company?.verificationStatus ?? null);
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
      role: user.role,
      companyVerificationStatus,
    };
  }
}
