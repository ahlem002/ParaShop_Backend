import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '../common/enums/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApprovedCompanyGuard } from '../auth/guards/approved-company.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CompanyStatsService } from './company-stats.service';

@Controller('company')
@UseGuards(AuthGuard('jwt'), RolesGuard, ApprovedCompanyGuard)
@Roles(Role.COMPANY)
export class CompanyStatsController {
  constructor(private readonly companyStatsService: CompanyStatsService) {}

  @Get('stats')
  getStats(@CurrentUser() user: JwtPayload) {
    return this.companyStatsService.getDashboardStats(user.sub);
  }
}
