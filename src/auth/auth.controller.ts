import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AuthService } from './auth.service';
import { RegisterClientDto } from './dto/register-client.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

const proofsDir = join(process.cwd(), 'uploads', 'proofs');
const profilesDir = join(process.cwd(), 'uploads', 'profiles');

for (const dir of [proofsDir, profilesDir]) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/client')
  registerClient(@Body() dto: RegisterClientDto) {
    return this.authService.registerClient(dto);
  }

  @Post('register/company')
  @UseInterceptors(
    FileInterceptor('proofDocument', {
      storage: diskStorage({
        destination: proofsDir,
        filename: (_req, file, callback) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          callback(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, callback) => {
        const allowed = /\.(pdf|png|jpe?g|webp)$/i.test(file.originalname);
        if (!allowed) {
          callback(
            new BadRequestException(
              'Proof document must be a PDF or image (png, jpg, webp)',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  registerCompany(
    @Body() dto: RegisterCompanyDto,
    @UploadedFile() proofFile?: Express.Multer.File,
  ) {
    return this.authService.registerCompany({
      ...dto,
      proofDocument: proofFile
        ? `/uploads/proofs/${proofFile.filename}`
        : undefined,
    });
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.authService.getProfile(user.sub);
  }

  @Patch('profile')
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(
    FileInterceptor('profileImage', {
      storage: diskStorage({
        destination: profilesDir,
        filename: (_req, file, callback) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          callback(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, callback) => {
        const allowed = /\.(png|jpe?g|webp)$/i.test(file.originalname);
        if (!allowed) {
          callback(
            new BadRequestException(
              'Profile image must be png, jpg, or webp',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
    @UploadedFile() profileImageFile?: Express.Multer.File,
  ) {
    return this.authService.updateProfile(
      user.sub,
      dto,
      profileImageFile
        ? `/uploads/profiles/${profileImageFile.filename}`
        : undefined,
    );
  }
}
