import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { UpdateAdminClientDto } from './dto/update-admin-client.dto';
import { UpdateAdminCompanyDto } from './dto/update-admin-company.dto';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  getDashboard() {
    return this.adminService.getDashboardStats();
  }

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

  @Patch('users/:userId')
  updateUser(
    @Param('userId') userId: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    return this.adminService.updateUser(userId, dto);
  }

  @Delete('users/:userId')
  deleteUser(@Param('userId') userId: string) {
    return this.adminService.deleteUser(userId);
  }

  @Get('drivers')
  getDrivers() {
    return this.adminService.findAllDrivers();
  }

  @Post('drivers')
  createDriver(@Body() dto: CreateDriverDto) {
    return this.adminService.createDriver(dto);
  }

  @Get('drivers/:userId')
  getDriver(@Param('userId') userId: string) {
    return this.adminService.getDriver(userId);
  }

  @Post('drivers/:userId/resend-invite')
  resendDriverInvite(@Param('userId') userId: string) {
    return this.adminService.resendDriverInvite(userId);
  }

  @Patch('drivers/:userId')
  updateDriver(
    @Param('userId') userId: string,
    @Body() dto: UpdateDriverDto,
  ) {
    return this.adminService.updateDriver(userId, dto);
  }

  @Delete('drivers/:userId')
  deleteDriver(@Param('userId') userId: string) {
    return this.adminService.deleteDriver(userId);
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

  @Patch('clients/:clientId')
  updateClient(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateAdminClientDto,
  ) {
    return this.adminService.updateClient(clientId, dto);
  }

  @Delete('clients/:clientId')
  deleteClient(@Param('clientId') clientId: string) {
    return this.adminService.deleteClient(clientId);
  }

  @Get('companies')
  getCompanies() {
    return this.adminService.findAllCompanies();
  }

  @Patch('companies/:companyId')
  updateCompany(
    @Param('companyId') companyId: string,
    @Body() dto: UpdateAdminCompanyDto,
  ) {
    return this.adminService.updateCompany(companyId, dto);
  }

  @Delete('companies/:companyId')
  deleteCompany(@Param('companyId') companyId: string) {
    return this.adminService.deleteCompany(companyId);
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
