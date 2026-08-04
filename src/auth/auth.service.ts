import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHmac, randomBytes } from 'crypto';
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
import {
  ChangePasswordDto,
  DisableTwoFactorDto,
  TwoFactorCodeDto,
  VerifyTwoFactorLoginDto,
} from './dto/security.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { MailService } from '../mail/mail.service';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from '../common/enums/activity-type.enum';

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
  twoFactorEnabled: boolean;
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

export type LoginResult =
  | AuthResponse
  | { requiresTwoFactor: true; tempToken: string };

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly activityService: ActivityService,
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
        twoFactorEnabled: false,
        twoFactorSecret: null,
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

    const result = await this.dataSource.transaction(async (manager) => {
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
        twoFactorEnabled: false,
        twoFactorSecret: null,
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

      const savedCompany = await companiesRepository.save(company);

      const fullUser = await usersRepository.findOne({
        where: { userId: savedUser.userId },
        relations: { company: true },
      });

      return {
        auth: this.buildAuthResponse(
          fullUser ?? savedUser,
          VerificationStatus.PENDING,
        ),
        companyId: savedCompany.companyId,
        companyName: savedCompany.companyName,
      };
    });

    void this.notificationsService.notifyAdmins({
      type: NotificationType.COMPANY_PENDING,
      title: 'New company registration',
      message: `${result.companyName} has registered and awaits verification.`,
      link: '/admin/validations',
      relatedId: result.companyId,
    });

    void this.mailService.sendNotificationEmail({
      to: normalizedEmail,
      title: 'Thank you for registering with ParaShop+',
      message: `Hi ${dto.firstName}, thank you for creating a company account for ${result.companyName}. Your registration is pending admin approval. We appreciate your patience — you will be able to access the company panel once an administrator verifies your account.`,
      link: '/company/pending',
    });

    return result.auth;
  }

  async login(dto: LoginDto): Promise<LoginResult> {
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

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const tempToken = this.jwtService.sign(
        { sub: user.userId, purpose: '2fa' },
        { expiresIn: '5m' },
      );
      return { requiresTwoFactor: true, tempToken };
    }

    const auth = this.buildAuthResponse(
      user,
      user.company?.verificationStatus ?? null,
    );

    await this.activityService.log({
      userId: user.userId,
      type: ActivityType.LOGIN,
      title: 'Signed in',
      message: 'You signed in to your account',
    });

    return auth;
  }

  async verifyTwoFactorLogin(
    dto: VerifyTwoFactorLoginDto,
  ): Promise<AuthResponse> {
    let payload: { sub?: string; purpose?: string };
    try {
      payload = this.jwtService.verify(dto.tempToken);
    } catch {
      throw new UnauthorizedException(
        'Verification session expired. Sign in again.',
      );
    }

    if (!payload.sub || payload.purpose !== '2fa') {
      throw new UnauthorizedException('Invalid verification session');
    }

    const user = await this.loadUserWithRelations(payload.sub);

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException(
        'Two-factor authentication is not enabled',
      );
    }

    if (!this.verifyTotp(user.twoFactorSecret, dto.code)) {
      throw new UnauthorizedException('Invalid authentication code');
    }

    const auth = this.buildAuthResponse(
      user,
      user.company?.verificationStatus ?? null,
    );

    await this.activityService.log({
      userId: user.userId,
      type: ActivityType.LOGIN,
      title: 'Signed in',
      message: 'You signed in with two-factor authentication',
    });

    return auth;
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.usersRepository.findOne({ where: { userId } });
    if (!user) {
      throw new UnauthorizedException();
    }

    const matches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!matches) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, this.saltRounds);
    await this.usersRepository.save(user);

    await this.activityService.log({
      userId,
      type: ActivityType.PASSWORD_CHANGED,
      title: 'Password changed',
      message: 'Your account password was updated',
    });

    return { message: 'Password updated successfully' };
  }

  async setupTwoFactor(userId: string) {
    const user = await this.loadUserWithRelations(userId);

    if (user.twoFactorEnabled) {
      throw new BadRequestException(
        'Two-factor authentication is already enabled',
      );
    }

    const secret = this.generateBase32Secret();
    user.twoFactorSecret = secret;
    user.twoFactorEnabled = false;
    await this.usersRepository.save(user);

    const otpauthUrl = `otpauth://totp/ParaShop+:${encodeURIComponent(user.email)}?secret=${secret}&issuer=ParaShop%2B&algorithm=SHA1&digits=6&period=30`;

    return {
      secret,
      otpauthUrl,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`,
    };
  }

  async enableTwoFactor(userId: string, dto: TwoFactorCodeDto) {
    const user = await this.usersRepository.findOne({ where: { userId } });
    if (!user) {
      throw new UnauthorizedException();
    }

    if (!user.twoFactorSecret) {
      throw new BadRequestException(
        'Start setup before enabling two-factor authentication',
      );
    }

    if (user.twoFactorEnabled) {
      throw new BadRequestException(
        'Two-factor authentication is already enabled',
      );
    }

    if (!this.verifyTotp(user.twoFactorSecret, dto.code)) {
      throw new BadRequestException('Invalid authentication code');
    }

    user.twoFactorEnabled = true;
    await this.usersRepository.save(user);

    await this.activityService.log({
      userId,
      type: ActivityType.TWO_FACTOR_ENABLED,
      title: '2FA enabled',
      message: 'Two-factor authentication was enabled on your account',
    });

    return this.getProfile(userId);
  }

  async disableTwoFactor(userId: string, dto: DisableTwoFactorDto) {
    const user = await this.usersRepository.findOne({ where: { userId } });
    if (!user) {
      throw new UnauthorizedException();
    }

    const matches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!matches) {
      throw new BadRequestException('Password is incorrect');
    }

    if (user.twoFactorEnabled && user.twoFactorSecret) {
      if (!this.verifyTotp(user.twoFactorSecret, dto.code)) {
        throw new BadRequestException('Invalid authentication code');
      }
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    await this.usersRepository.save(user);

    await this.activityService.log({
      userId,
      type: ActivityType.TWO_FACTOR_DISABLED,
      title: '2FA disabled',
      message: 'Two-factor authentication was disabled on your account',
    });

    return this.getProfile(userId);
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
      await this.usersRepository.update({ userId }, { profileImage });
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

    await this.activityService.log({
      userId,
      type: ActivityType.PROFILE_UPDATED,
      title: 'Profile updated',
      message: profileImage
        ? 'You updated your profile details and photo'
        : 'You updated your profile details',
      metadata: {
        fields: Object.keys(dto).filter(
          (key) => (dto as Record<string, unknown>)[key] !== undefined,
        ),
        profileImageChanged: profileImage !== undefined,
      },
    });

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
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
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

  private formatDateOnly(
    value: string | Date | null | undefined,
  ): string | null {
    if (!value) return null;
    if (typeof value === 'string') {
      return value.slice(0, 10);
    }
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private generateBase32Secret(bytes = 20): string {
    const buffer = randomBytes(bytes);
    let bits = 0;
    let value = 0;
    let output = '';

    for (const byte of buffer) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return output;
  }

  private base32ToBuffer(secret: string): Buffer {
    const cleaned = secret.replace(/=+$/, '').toUpperCase();
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];

    for (const char of cleaned) {
      const idx = BASE32_ALPHABET.indexOf(char);
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }

    return Buffer.from(bytes);
  }

  private generateTotp(secret: string, windowOffset = 0): string {
    const counter = Math.floor(Date.now() / 1000 / 30) + windowOffset;
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    buffer.writeUInt32BE(counter & 0xffffffff, 4);

    const key = this.base32ToBuffer(secret);
    const hmac = createHmac('sha1', key).update(buffer).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    return String(code % 1_000_000).padStart(6, '0');
  }

  private verifyTotp(secret: string, code: string): boolean {
    const normalized = code.trim();
    if (!/^\d{6}$/.test(normalized)) return false;

    for (let offset = -1; offset <= 1; offset += 1) {
      if (this.generateTotp(secret, offset) === normalized) {
        return true;
      }
    }
    return false;
  }
}
