import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '../common/enums/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AdminService } from './admin.service';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateCompanyVerificationDto } from './dto/update-company-verification.dto';
import { UpdateProductVerificationDto } from './dto/update-product-verification.dto';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  getUsers() {
    return this.adminService.findAllUsers();
  }

  @Patch('users/:userId/status')
  updateUserStatus(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.adminService.updateUserStatus(userId, dto);
  }

  @Get('clients')
  getClients() {
    return this.adminService.findAllClients();
  }

  @Patch('clients/:clientId/status')
  updateClientStatus(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.adminService.updateClientStatus(clientId, dto);
  }

  @Get('companies')
  getCompanies() {
    return this.adminService.findAllCompanies();
  }

  @Patch('companies/:companyId/verification')
  updateCompanyVerification(
    @Param('companyId') companyId: string,
    @Body() dto: UpdateCompanyVerificationDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.adminService.updateCompanyVerification(
      companyId,
      dto,
      admin.sub,
    );
  }

  @Get('products')
  getProducts() {
    return this.adminService.findAllProducts();
  }

  @Patch('products/:productId/verification')
  updateProductVerification(
    @Param('productId') productId: string,
    @Body() dto: UpdateProductVerificationDto,
  ) {
    return this.adminService.updateProductVerification(productId, dto);
  }
}
